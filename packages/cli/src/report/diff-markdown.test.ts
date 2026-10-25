import { countSteps, DIFF_FORMAT_VERSION, type DiffReport, type FlowChange, type SequenceChange } from '@flowatlas/linker';
import { describe, expect, it } from 'vitest';
import { sequenceBlocksIn, sequenceProblems } from '../render/mermaid-sequence-check.js';
import { renderDiffMarkdown, summariseDiff } from './diff-markdown.js';

const emptyCounts = { nodes: 0, edges: 0, types: 0, unresolved: { rows: 0, sites: 0 } };

const report = (flows: FlowChange[]): DiffReport => ({
  diffFormatVersion: DIFF_FORMAT_VERSION,
  schemaVersion: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  base: { ref: 'main', services: {} },
  head: { ref: null, services: {} },
  nodes: { added: [], removed: [], changed: [], moved: [] },
  edges: { added: [], removed: [], changed: [] },
  types: { added: [], removed: [], changed: [] },
  counts: { base: emptyCounts, head: emptyCounts },
  unresolved: { added: [], removed: [] },
  joins: { lost: [] },
  impact: [],
  flows,
  contracts: { new: [], fixed: [], preexisting: [], ignored: [] },
  rules: { new: [], fixed: [], existing: [], excused: [] },
  spec: null,
  warnings: [],
  timing: { baseMs: 0, headMs: 0, diffMs: 0, totalMs: 0 },
});

const step = (label: string, status: SequenceChange['status'], extra: Partial<SequenceChange> = {}): SequenceChange => ({
  status,
  kind: 'http_calls',
  from: 'orders',
  to: 'billing',
  label,
  confidence: 'static',
  file: 'src/orders.service.ts',
  line: 12,
  ...extra,
});

const flow = (label: string, steps: SequenceChange[], extra: Partial<FlowChange> = {}): FlowChange => ({
  entry: `entry:orders:http:${label.replace(' ', ':')}`,
  label,
  service: 'orders',
  side: 'both',
  reaches: 1,
  participants: [
    { id: 'caller', label: 'client', kind: 'caller' },
    { id: 'orders', label: 'orders', kind: 'service', service: 'orders' },
    { id: 'billing', label: 'billing', kind: 'service', service: 'billing' },
  ],
  steps,
  counts: countSteps(steps),
  ...extra,
});

const enters = (label: string): SequenceChange => step(label, 'same', { kind: 'enters', from: 'caller', to: 'orders', file: 'src/orders.controller.ts', line: 3 });

describe('Changed flows in the diff document (P116)', () => {
  const changed = flow('POST /orders', [enters('POST /orders'), step('POST /invoices', 'removed'), step('PUT /invoices', 'added'), step('GET /rates', 'changed', { note: 'body: +currency (required)' })]);
  const unchanged = flow('GET /orders', [enters('GET /orders'), step('GET /totals', 'same')]);

  it('draws each changed flow after the impact, the first open, with its steps listed under it', () => {
    const text = renderDiffMarkdown(report([changed, unchanged]), { file: 'out/diff.json' });
    expect(text.indexOf('## Changed flows')).toBeGreaterThan(text.indexOf('## Impact'));
    expect(text.indexOf('## Changed flows')).toBeLessThan(text.indexOf('## Contract changes'));
    expect(text).toContain('<details open><summary><code>POST /orders</code> (orders) — 1 step added, 1 removed, 1 changed; crosses orders → billing</summary>');
    expect(text).toContain(
      [
        '```diff',
        '  client → orders POST /orders  · orders/src/orders.controller.ts:3',
        '- orders → billing POST /invoices  · orders/src/orders.service.ts:12',
        '+ orders → billing PUT /invoices  · orders/src/orders.service.ts:12',
        '~ orders → billing GET /rates (body: +currency (required))  · orders/src/orders.service.ts:12',
        '```',
      ].join('\n'),
    );
    expect(text).toContain('Ways in whose steps did not change: `GET /orders` (orders)');
    const diagrams = sequenceBlocksIn(text);
    expect(diagrams).toHaveLength(1);
    expect(sequenceProblems(diagrams[0] as string)).toEqual([]);
    expect(summariseDiff(report([changed, unchanged]))).toContain('flows 1 changed');
  });

  it('names and counts the changed flows past --max-diagrams', () => {
    const flows = ['POST /a', 'POST /b', 'POST /c'].map((label) => flow(label, [enters(label), step('x', 'added')]));
    const text = renderDiffMarkdown(report(flows), { maxDiagrams: 1, file: 'out/diff.json' });
    expect(sequenceBlocksIn(text)).toHaveLength(1);
    expect(text).toContain('… 2 more changed flows: `POST /b`, `POST /c`; every flow is in out/diff.json');
  });

  it('lists the steps without a diagram when told to', () => {
    const text = renderDiffMarkdown(report([changed]), { diagrams: false });
    expect(sequenceBlocksIn(text)).toHaveLength(0);
    expect(text).toContain('+ orders → billing PUT /invoices');
  });

  it('drops diagrams from the last back, then flows, to stay under --max-chars', () => {
    const many = Array.from({ length: 4 }, (_, k) => flow(`POST /f${k}`, [enters(`POST /f${k}`), ...Array.from({ length: 6 }, (_x, n) => step(`GET /s${k}-${n}`, 'added'))]));
    const whole = renderDiffMarkdown(report(many), { file: 'out/diff.json' });
    expect(sequenceBlocksIn(whole)).toHaveLength(4);

    const squeezed = renderDiffMarkdown(report(many), { file: 'out/diff.json', maxChars: whole.length - 200 });
    expect(squeezed.length).toBeLessThanOrEqual(whole.length - 200);
    expect(sequenceBlocksIn(squeezed)).toHaveLength(3);
    expect(squeezed).toContain('… 1 diagram left out to keep this under');
    // The flow that lost its diagram is the last one, and its steps are still listed.
    expect(squeezed).toContain('+ orders → billing GET /s3-0');

    const tight = renderDiffMarkdown(report(many), { file: 'out/diff.json', maxChars: 2_000 });
    expect(sequenceBlocksIn(tight)).toHaveLength(0);
    expect(tight).toMatch(/… \d more changed flows \(\d left out to keep this under 2000 characters\)/);
  });

  it('says a way in only one side has is added or removed', () => {
    const added = flow('GET /new', [{ ...enters('GET /new'), status: 'added' }], { side: 'head' });
    const removed = flow('GET /old', [{ ...enters('GET /old'), status: 'removed' }], { side: 'base' });
    const text = renderDiffMarkdown(report([added, removed]));
    expect(text).toContain('<code>GET /new</code> (orders) — added, a way in the base did not have: 1 step');
    expect(text).toContain('<code>GET /old</code> (orders) — removed, as of base: 1 step gone');
  });

  it('leaves the section out when no flow was walked', () => {
    expect(renderDiffMarkdown(report([]))).not.toContain('## Changed flows');
  });
});

describe('Gaps and findings in the diff document (P194)', () => {
  const ref = { kind: 'gap' as const, service: 'gateway', file: 'src/clients/orders.client.ts', reason: 'target-route-not-found', sites: 1 };

  it('says how many sites a gap id the base had already holds beside the new one', () => {
    const grown = {
      ...report([]),
      unresolved: {
        added: [
          { ...ref, id: 'gap:gateway|src/clients/orders.client.ts|target-route-not-found', line: 31, kept: 1 },
          { ...ref, id: 'gap:gateway|src/clients/refunds.client.ts|target-route-not-found', file: 'src/clients/refunds.client.ts', line: 8 },
        ],
        removed: [],
      },
    };
    const text = renderDiffMarkdown(grown, { file: 'out/diff.json' });

    expect(text).toContain('| gap, 1 more beside 1 | `target-route-not-found` | `gateway src/clients/orders.client.ts:31` |');
    expect(text).toContain('| gap | `target-route-not-found` | `gateway src/clients/refunds.client.ts:8` |');
    expect(summariseDiff(grown)).toContain('gaps +2/-0');
  });
});

describe('Only some sections of the diff document', () => {
  const changed = flow('POST /orders', [enters('POST /orders'), step('POST /invoices', 'removed')]);

  it('prints the sections asked for, in the document\'s order, with no heading, side table or footer', () => {
    const text = renderDiffMarkdown(report([changed]), { file: 'out/diff.json', sections: ['flows', 'impact'] });
    expect(text.startsWith('## Impact')).toBe(true);
    expect(text.indexOf('## Changed flows')).toBeGreaterThan(text.indexOf('## Impact'));
    expect(text).not.toContain('## flowatlas diff');
    expect(text).not.toContain('## Contract changes');
    expect(text).not.toContain('## Graph');
    expect(text).not.toContain('ms total');
  });

  it('keeps the warnings, since what could not be read qualifies every section', () => {
    const unread = { ...report([]), warnings: [{ reason: 'ref-not-found', service: 'orders', message: 'orders has no ref main.', hint: 'Fetch it.' }] } as DiffReport;
    const text = renderDiffMarkdown(unread, { sections: ['impact'] });
    expect(text.indexOf('## Warnings')).toBe(0);
    expect(text).toContain('## Impact');
  });

  it('prints the whole document when no section is named', () => {
    const text = renderDiffMarkdown(report([changed]), { sections: [] });
    expect(text).toContain('## flowatlas diff');
    expect(text).toContain('## Graph');
  });
});
