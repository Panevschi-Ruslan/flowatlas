import { describe, expect, it } from 'vitest';
import { collectFindings, rankFindings } from './findings.js';
import { buildTestDb, edge, node } from './__fixtures__/test-db.js';

const route = (id: string, over = {}) => node(id, { type: 'entry', kind: 'http', ...over });
const loop = (symbol: string, line: number, severity: 'likely' | 'note', waysIn: number) => ({
  service: 'orders',
  file: 'src/s.ts',
  line,
  reason: 'query-in-loop',
  level: 'info' as const,
  message: `a query per item in ${symbol}`,
  symbol,
  meta: { severity, waysIn },
});

/** Findings ranked by reach (P95): each kind by the fact it is measured by. */
describe('findings', () => {
  it('ranks likely N+1 loops by the ways in that reach them, and counts the per-item ones apart', () => {
    const db = buildTestDb({
      nodes: [node('orders#src/s.ts:S.export'), node('orders#src/s.ts:S.list'), node('orders#src/s.ts:S.each')],
      edges: [],
      unresolved: [
        loop('orders#src/s.ts:S.export', 10, 'likely', 1),
        loop('orders#src/s.ts:S.list', 20, 'likely', 4),
        loop('orders#src/s.ts:S.each', 30, 'note', 9),
      ],
    });
    const { findings, notes } = collectFindings(db, { rows: db.allUnresolved() });
    const ranked = rankFindings(db, findings);
    db.close();
    expect(ranked.map((row) => `${row.rank} ${row.id} ${row.reach.waysIn}`)).toEqual([
      '1 orders#src/s.ts:S.list 4',
      '2 orders#src/s.ts:S.export 1',
    ]);
    expect(notes).toEqual({ 'n-plus-one': 1 });
  });

  it('ranks unguarded routes by the writes they reach before the reads, naming the route and its handler', () => {
    const write = (id: string) => node(id, { type: 'db_query', meta: { op: 'write' } });
    const read = (id: string) => node(id, { type: 'db_query', meta: { op: 'read' } });
    const unguarded = (said: string, line: number) => ({
      service: 'orders',
      file: 'src/c.ts',
      line,
      reason: 'route-unguarded',
      level: 'action' as const,
      message: `${said} has no guard in front of it`,
      symbol: said,
    });
    const db = buildTestDb({
      nodes: [
        route('entry:orders:http:GET:/list', { label: 'GET /list' }),
        route('entry:orders:http:POST:/save', { label: 'POST /save' }),
        node('orders#src/c.ts:C.list'),
        node('orders#src/c.ts:C.save'),
        read('db_query:orders#src/s.ts:1:1'),
        read('db_query:orders#src/s.ts:2:1'),
        write('db_query:orders#src/s.ts:3:1'),
      ],
      edges: [
        edge('entry:orders:http:GET:/list', 'orders#src/c.ts:C.list', { type: 'handles' }),
        edge('entry:orders:http:POST:/save', 'orders#src/c.ts:C.save', { type: 'handles' }),
        edge('orders#src/c.ts:C.list', 'db_query:orders#src/s.ts:1:1', { type: 'queries' }),
        edge('orders#src/c.ts:C.list', 'db_query:orders#src/s.ts:2:1', { type: 'queries' }),
        edge('orders#src/c.ts:C.save', 'db_query:orders#src/s.ts:3:1', { type: 'queries' }),
      ],
      unresolved: [unguarded('GET /list', 5), unguarded('POST /save', 9)],
    });
    const ranked = rankFindings(db, collectFindings(db, { rows: db.allUnresolved() }).findings);
    db.close();
    expect(ranked.map((row) => [row.kind, row.id, row.method, row.reach])).toEqual([
      ['unguarded', 'entry:orders:http:POST:/save', 'orders#src/c.ts:C.save', { writes: 1, reads: 0 }],
      ['unguarded', 'entry:orders:http:GET:/list', 'orders#src/c.ts:C.list', { writes: 0, reads: 2 }],
    ]);
  });

  it('ranks contract breaks by severity, then by the ways in that reach the sending side, and skips remarks and ignored ones', () => {
    const db = buildTestDb({
      nodes: [
        route('entry:web:http:GET:/a'),
        route('entry:web:http:GET:/b'),
        node('web#src/a.ts:A.go'),
        node('http_out:web#src/a.ts:3:1', { type: 'http_out', repo: 'web' }),
        node('http_out:web#src/b.ts:3:1', { type: 'http_out', repo: 'web' }),
        route('entry:orders:http:POST:/orders'),
      ],
      edges: [
        edge('entry:web:http:GET:/a', 'web#src/a.ts:A.go', { type: 'handles' }),
        edge('entry:web:http:GET:/b', 'web#src/a.ts:A.go', { type: 'handles' }),
        edge('web#src/a.ts:A.go', 'http_out:web#src/a.ts:3:1'),
      ],
    });
    const at = (from: string) => ({ from, to: 'entry:orders:http:POST:/orders', type: 'http_calls' });
    const contracts = [
      { severity: 'warning', kind: 'optional_mismatch', message: 'b warns', edge: at('http_out:web#src/b.ts:3:1') },
      { severity: 'warning', kind: 'optional_mismatch', message: 'a warns', edge: at('http_out:web#src/a.ts:3:1') },
      { severity: 'error', kind: 'missing_field', message: 'b errs', edge: at('http_out:web#src/b.ts:3:1') },
      { severity: 'info', kind: 'extra_field', message: 'a remarks', edge: at('http_out:web#src/a.ts:3:1') },
      { severity: 'error', kind: 'missing_field', message: 'a ignored', edge: at('http_out:web#src/a.ts:3:1'), ignored: true },
    ];
    const ranked = rankFindings(db, collectFindings(db, { rows: [], contracts }).findings);
    db.close();
    expect(ranked.map((row) => `${row.rank} ${row.message} ${row.reach.callers}`)).toEqual([
      '1 b errs 0',
      '2 a warns 2',
      '3 b warns 0',
    ]);
  });
  it('lists a broken architecture rule as kind rule, errors first, then the busier start (P114)', () => {
    const db = buildTestDb({
      nodes: [route('entry:web:http:GET:/a'), node('web#src/a.ts:A.call'), node('web#src/b.ts:B.call')],
      edges: [edge('entry:web:http:GET:/a', 'web#src/b.ts:B.call', { type: 'handles' })],
      unresolved: [],
    });
    const violation = (from: string, severity: 'error' | 'warning', line: number) => ({
      rule: severity === 'error' ? 'web-not-billing' : 'web-quiet',
      shape: 'forbid' as const,
      severity,
      key: `rule|x|${from}|to`,
      from,
      to: 'entry:billing:http:POST:/invoices',
      fromService: 'web',
      toService: 'billing',
      via: 'hits',
      path: [],
      at: { service: 'web', file: 'src/a.ts', line },
      confidence: 'static' as const,
      heuristic: false,
      message: 'web requests billing POST /invoices',
    });
    const { findings } = collectFindings(db, {
      rows: [],
      rules: [violation('web#src/a.ts:A.call', 'warning', 3), violation('web#src/a.ts:A.call', 'error', 4), violation('web#src/b.ts:B.call', 'error', 5)],
    });
    const ranked = rankFindings(db, findings);
    db.close();
    expect(ranked.map((row) => `${row.kind} ${row.rank} ${row.id} ${row.severity} ${row.loc}`)).toEqual([
      'rule 1 web#src/b.ts:B.call error src/a.ts:5',
      'rule 2 web#src/a.ts:A.call error src/a.ts:4',
      'rule 3 web#src/a.ts:A.call warning src/a.ts:3',
    ]);
    expect(ranked[0]?.message).toBe('web-not-billing: web requests billing POST /invoices');
  });
});
