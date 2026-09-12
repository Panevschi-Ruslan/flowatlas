import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CliError, EXIT } from '../exit.js';
import { FORMATS } from '../options.js';
import type { QueryIo } from '../query/answer.js';
import { buildTestProject } from '../test-graph.js';
import { runChannel } from './channel.js';
import { runFlow } from './flow.js';
import { reachableSummary } from '../query/callers.js';
import { runImpact } from './impact.js';
import { runStats } from './stats.js';
import { DRIFT_NOTE, runTypes } from './types.js';

let dbPath: string;

beforeAll(() => {
  dbPath = buildTestProject('commands').dbPath;
});

interface Capture extends QueryIo {
  stdout: string;
  stderr: string;
}

const capture = (tty = false): Capture => {
  const held = {
    stdout: '',
    stderr: '',
    tty,
    out(text: string) {
      held.stdout += text;
    },
    err(text: string) {
      held.stderr += text;
    },
  };
  return held;
};

const ENTRY = 'entry:gateway:http:POST:/orders';

const flow = (over: Record<string, unknown> = {}, tty = false): Capture => {
  const io = capture(tty);
  runFlow(ENTRY, { db: dbPath, ...over }, io);
  return io;
};

const parsed = (text: string): Record<string, unknown> => JSON.parse(text) as Record<string, unknown>;

const stop = (run: () => unknown): CliError => {
  try {
    run();
  } catch (error) {
    return error as CliError;
  }
  throw new Error('expected a stop');
};

afterAll(() => undefined);

describe('following an entry point', () => {
  it('walks from a route across every repository it reaches', () => {
    const text = flow({ format: 'tree', depth: '12' }).stdout;
    expect(text).toContain('POST /orders');
    expect(text).toContain('⇢ orders');
    expect(text).toContain('order.created');
    expect(text).toContain('▣  write Invoice');
  });

  it('answers for a bot callback through the same command and renderer', () => {
    const io = capture();
    runFlow('bot:order_confirm', { db: dbPath, format: 'tree' }, io);
    // The same handler, drawn the same way; only the glyph on the root differs.
    expect(io.stdout).toContain('OrdersService.create');
    expect(io.stdout.split('\n')[0]).toContain('🤖');
    expect(flow({ format: 'tree' }).stdout.split('\n')[0]).toContain('◆');
  });

  it('renders in every format at every level', () => {
    for (const format of FORMATS) {
      for (const detail of ['0', '1', '2', '3']) {
        expect(flow({ format, detail }).stdout.length).toBeGreaterThan(0);
      }
    }
  });

  it('says nothing but id, type and label at level zero', () => {
    const payload = parsed(flow({ format: 'json', detail: '0' }).stdout) as {
      root: { node: Record<string, unknown> };
    };
    expect(Object.keys(payload.root.node).sort()).toEqual(['id', 'label', 'type']);
  });

  it('carries the type structures it mentions from level two', () => {
    const payload = parsed(flow({ format: 'json', detail: '2' }).stdout) as {
      types?: Record<string, { fields?: unknown[] }>;
    };
    expect(payload.types?.['type:@fx/contracts#OrderDto']).toBeDefined();
    // Nesting is followed, and the plan caps it at three.
    expect(payload.types?.['type:@fx/contracts#Money']).toBeDefined();
  });

  it('says on stderr that a diagram cannot carry code, and draws it anyway', () => {
    const io = flow({ format: 'mermaid', detail: '3' });
    expect(io.stderr).toContain('source omitted for mermaid');
    expect(io.stdout).toContain('flowchart LR');
  });

  it('prints no more nodes than it was allowed, and says how many it left', () => {
    const io = flow({ format: 'tree', maxNodes: '3' });
    const drawn = io.stdout.split('\n').filter((line) => line.trim().length > 0);
    expect(drawn.filter((line) => line.startsWith('…'))).toHaveLength(1);
    expect(io.stdout).toMatch(/… truncated: \d+ more nodes \(raise --max-nodes or lower --depth\)/);
  });

  it('reports how much of the path could not be resolved', () => {
    expect(flow({ format: 'tree' }).stdout).toContain('unresolved on this path:');
    expect(parsed(flow({ format: 'json' }).stdout)['unresolvedOnPath']).toBeDefined();
  });

  it('writes JSON with no escape codes when nobody is watching', () => {
    const io = flow();
    expect(io.stdout.startsWith('{')).toBe(true);
    expect(io.stdout).not.toMatch(/\u001B\[/);
  });

  it('draws a coloured tree when somebody is', () => {
    expect(flow({}, true).stdout).toMatch(/\u001B\[/);
  });

  it('stops with a usable exit code for each kind of failure', () => {
    expect(stop(() => runFlow('POST /orders', { db: dbPath }, capture())).code).toBe(EXIT.failed);
    expect(stop(() => runFlow('POST /nope', { db: dbPath }, capture())).code).toBe(EXIT.failed);
    expect(stop(() => runFlow(ENTRY, { db: '/no/such.db' }, capture())).code).toBe(EXIT.cannotRun);
    expect(stop(() => runFlow(ENTRY, { db: dbPath, detail: '7' }, capture())).code).toBe(
      EXIT.cannotRun,
    );
  });
});

describe('asking what reaches a symbol', () => {
  it('names every entry point it can be reached from', () => {
    const io = capture();
    runImpact('OrdersService.create', { db: dbPath, service: 'gateway', format: 'tree' }, io);
    expect(io.stdout).toContain('POST /orders');
    expect(io.stdout).toContain('order_confirm');
    expect(io.stdout).toMatch(/Reachable from: 1 http entry \(gateway\), 1 bot callback \(gateway\)/);
  });

  it('lists the ways in without the chain between, when asked', () => {
    const io = capture();
    runImpact(
      'OrdersService.create',
      { db: dbPath, service: 'gateway', format: 'json', entriesOnly: true },
      io,
    );
    const payload = parsed(io.stdout) as { root: { children: unknown[] }; entries: string[] };
    expect(payload.root.children).toHaveLength(payload.entries.length);
  });

  it('stops rather than guessing which service was meant', () => {
    expect(stop(() => runImpact('OrdersService.create', { db: dbPath }, capture())).code).toBe(
      EXIT.failed,
    );
  });

  it('answers what would break if a table changed', () => {
    // The reverse walk used to follow only the edges between methods, so a
    // table, a channel and a setting were all dead ends and this returned
    // nothing at all (R03).
    const io = capture();
    runImpact('table:billing#Invoice', { db: dbPath, format: 'json' }, io);
    const payload = parsed(io.stdout) as { reached: number; entries: string[] };
    expect(payload.reached).toBeGreaterThan(0);
    expect(payload.entries.length).toBeGreaterThan(0);
  });

  it('names what publishes to the channel a handler is on', () => {
    const io = capture();
    runImpact('consumer:billing#src/invoices/invoices.consumer.ts:9', { db: dbPath, format: 'json' }, io);
    const payload = parsed(io.stdout) as { root: unknown; services: string[] };
    // The publisher is in `orders`, one hop past the channel, which is where the
    // walk used to stop.
    expect(payload.services).toContain('orders');
  });

  it('says a service is in the blast radius even with no way in above it', () => {
    const entry = {
      id: 'entry:admin:http:GET:/a',
      type: 'entry' as const,
      kind: 'http',
      label: 'GET /a',
      repo: 'admin',
    };
    // Reporting only the entry points answered "1 http entry (admin)" for a
    // change a bot in another repository also reaches, which reads as nothing
    // outside admin being affected (R03).
    expect(reachableSummary([entry], ['bot'])).toBe(
      'Reachable from: 1 http entry (admin). Also reaches bot, where the chain stops before an entry point',
    );
    expect(reachableSummary([entry])).toBe('Reachable from: 1 http entry (admin)');
  });

  it('says which services it reached without finding a way in above them', () => {
    const io = capture();
    runImpact('OrdersService.create', { db: dbPath, service: 'orders', format: 'json' }, io);
    const payload = parsed(io.stdout) as {
      services: string[];
      servicesWithoutEntry: string[];
      entries: string[];
    };
    expect(payload.services).toEqual(expect.arrayContaining(['gateway', 'orders']));
    // Everything reached here does have a way in, so the honest answer is none.
    expect(payload.servicesWithoutEntry).toEqual([]);
  });
});

describe('asking about a channel', () => {
  it('shows both ends and what the handler goes on to do', () => {
    const io = capture();
    runChannel('order.created', { db: dbPath, format: 'tree' }, io);
    expect(io.stdout).toContain('producers (1)');
    expect(io.stdout).toContain('consumers (1)');
    expect(io.stdout).toContain('InvoicesService.create');
  });

  it('says so when nothing handles it, and still succeeds', () => {
    const io = capture();
    runChannel('channel:order.archived', { db: dbPath, format: 'tree' }, io);
    expect(io.stdout).toContain('⚠ no consumers');
    expect(io.stdout).not.toContain('no producers');
  });

  it('carries the same warning as a field for a program', () => {
    const io = capture();
    runChannel('order.archived', { db: dbPath, format: 'json' }, io);
    expect(parsed(io.stdout)['warnings']).toEqual(['⚠ no consumers']);
  });
});

describe('listing the type registry', () => {
  it('reports one name declared two ways in two repositories', () => {
    const io = capture();
    runTypes({ db: dbPath, drift: true, format: 'json' }, io);
    const payload = parsed(io.stdout) as { drift: Array<{ name: string }>; note: string };
    expect(payload.drift.map((item) => item.name)).toEqual(['InvoiceDto']);
    expect(payload.note).toBe(DRIFT_NOTE);
  });

  it('leaves out a declaration both repositories import from one package', () => {
    const io = capture();
    runTypes({ db: dbPath, drift: true, format: 'json' }, io);
    expect(io.stdout).not.toContain('OrderDto');
  });

  it('narrows the list by name and by service', () => {
    const byName = capture();
    runTypes({ db: dbPath, name: 'Invoice*', format: 'json' }, byName);
    expect((parsed(byName.stdout) as { total: number }).total).toBe(2);

    const byService = capture();
    runTypes({ db: dbPath, service: 'billing', format: 'json' }, byService);
    expect((parsed(byService.stdout) as { total: number }).total).toBe(1);
  });

  it('shows the fields only at the level that promised them', () => {
    const bare = capture();
    runTypes({ db: dbPath, format: 'json', detail: '1' }, bare);
    expect(bare.stdout).not.toContain('"fields"');

    const full = capture();
    runTypes({ db: dbPath, format: 'json', detail: '2' }, full);
    expect(full.stdout).toContain('"fields"');
  });
});

describe('counting what the graph is made of', () => {
  it('breaks the graph down by type, service and confidence', () => {
    const io = capture();
    runStats({ db: dbPath, format: 'json' }, io);
    const stats = parsed(io.stdout) as {
      totals: { nodes: number; edges: number };
      nodesByType: Record<string, number>;
      edgesByType: Record<string, number>;
      edgesByConfidence: Record<string, number>;
      unresolvedByReason: Record<string, number>;
      unresolvedSites: Record<string, number>;
    };
    expect(Object.values(stats.nodesByType).reduce((a, b) => a + b, 0)).toBe(stats.totals.nodes);
    expect(Object.values(stats.edgesByType).reduce((a, b) => a + b, 0)).toBe(stats.totals.edges);
    expect(Object.values(stats.edgesByConfidence).reduce((a, b) => a + b, 0)).toBe(stats.totals.edges);
    expect(stats.unresolvedByReason).toEqual({
      'call-dynamic-receiver': 1,
      'di-token-unknown': 1,
      'unknown-base-url-env': 1,
    });
  });

  it('counts a folded reason by the places it stands for, not by the row', () => {
    const io = capture();
    runStats({ db: dbPath, format: 'json' }, io);
    const stats = parsed(io.stdout) as {
      totals: { unresolved: number };
      unresolvedByReason: Record<string, number>;
      unresolvedSites: Record<string, number>;
    };
    expect(stats.totals.unresolved).toBe(3);
    expect(stats.unresolvedByReason['call-dynamic-receiver']).toBe(1);
    expect(stats.unresolvedSites['call-dynamic-receiver']).toBe(12);

    const tree = capture();
    runStats({ db: dbPath, format: 'tree' }, tree);
    expect(tree.stdout).toContain('3 unresolved rows over 14 sites');
    expect(tree.stdout).toContain('call-dynamic-receiver  12  (listed as 1 row)');
  });

  it('prints the numbers the build wrote down', () => {
    const io = capture();
    runStats({ db: dbPath, format: 'tree' }, io);
    expect(io.stdout).toContain('calls out: 2 total, 1 linked (50%)');
    expect(io.stdout).toContain('channels with no handler: 1');
    expect(io.stdout).toContain('routes never called: 1 of 2');
  });

  it('refuses a format it cannot draw a report in', () => {
    expect(stop(() => runStats({ db: dbPath, format: 'mermaid' }, capture())).code).toBe(
      EXIT.cannotRun,
    );
  });
});
