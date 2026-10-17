import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Participant } from '@flowatlas/linker';
import { describe, expect, it } from 'vitest';
import { sequenceBlocksIn, sequenceProblems } from './mermaid-sequence-check.js';
import { foldSteps, mermaidText, renderSequenceDiagram, type DrawnStep } from './sequence.js';

const ROOT = resolve(import.meta.dirname, '../../../..');

const participants: Participant[] = [
  { id: 'caller', label: 'client', kind: 'caller' },
  { id: 'gateway', label: 'gateway', kind: 'service', service: 'gateway' },
  { id: 'orders', label: 'orders', kind: 'service', service: 'orders' },
  { id: 'table:orders/orders', label: 'orders (table)', kind: 'table', service: 'orders' },
  { id: 'channel:order.created', label: 'order.created (topic)', kind: 'channel' },
  { id: 'billing', label: 'billing', kind: 'service', service: 'billing' },
];

const step = (from: string, to: string, label: string, extra: Partial<DrawnStep> = {}): DrawnStep => ({
  kind: 'http_calls',
  from,
  to,
  label,
  confidence: 'static',
  ...extra,
});

const draw = (steps: DrawnStep[], options: Parameters<typeof renderSequenceDiagram>[1] = {}): string => {
  const text = renderSequenceDiagram({ participants, steps }, options);
  expect(sequenceProblems(text)).toEqual([]);
  return text;
};

describe('renderSequenceDiagram (P116)', () => {
  it('declares the caller, each service in its box with its tables, and a channel on its own', () => {
    const text = draw([
      step('caller', 'gateway', 'POST /orders', { kind: 'enters' }),
      step('gateway', 'orders', 'POST /orders'),
      step('orders', 'table:orders/orders', 'write orders', { kind: 'queries' }),
      step('orders', 'channel:order.created', 'order.created', { kind: 'emits' }),
      step('channel:order.created', 'billing', 'order.created', { kind: 'consumes' }),
    ]);
    expect(text).toBe(
      [
        'sequenceDiagram',
        '  autonumber',
        '  actor n_caller as client',
        '  box rgba(128,128,128,0.08) gateway',
        '    participant n_gateway as gateway',
        '  end',
        '  box rgba(128,128,128,0.08) orders',
        '    participant n_orders as orders',
        '    participant n_table_orders_orders as orders (table)',
        '  end',
        '  participant n_channel_order_created as order.created (topic)',
        '  box rgba(128,128,128,0.08) billing',
        '    participant n_billing as billing',
        '  end',
        '  n_caller->>n_gateway: POST /orders',
        '  n_gateway->>n_orders: POST /orders',
        '  n_orders->>n_table_orders_orders: write orders',
        '  n_orders-)n_channel_order_created: order.created',
        '  n_channel_order_created-)n_billing: order.created',
        '',
      ].join('\n'),
    );
  });

  it('marks added steps green with +, removed ones red with the cross arrow and −, changed ones with a note', () => {
    const text = draw([
      step('caller', 'gateway', 'POST /orders', { kind: 'enters', status: 'same' }),
      step('gateway', 'orders', 'POST /orders', { status: 'changed', note: 'body: +channel (required)' }),
      step('orders', 'billing', 'POST /invoices', { status: 'removed' }),
      step('orders', 'channel:order.created', 'order.created', { kind: 'emits', status: 'added' }),
      step('channel:order.created', 'billing', 'order.created', { kind: 'consumes', status: 'added' }),
    ]);
    expect(text).toContain(
      [
        '  rect rgba(210,153,34,0.18)',
        '    n_gateway->>n_orders: ~ POST /orders',
        '    Note over n_gateway,n_orders: body: +channel (required)',
        '  end',
        '  rect rgba(248,81,73,0.18)',
        '    n_orders-xn_billing: − POST /invoices',
        '  end',
        '  rect rgba(46,160,67,0.18)',
        '    n_orders-)n_channel_order_created: + order.created',
        '    n_channel_order_created-)n_billing: + order.created',
        '  end',
      ].join('\n'),
    );
  });

  it('folds a run of unchanged steps longer than the context into one note (D4)', () => {
    const same = (label: string): DrawnStep => step('orders', 'billing', label, { status: 'same' });
    const steps = [step('caller', 'orders', 'POST /orders', { kind: 'enters', status: 'same' }), same('a'), same('b'), same('c'), same('d'), same('e'), step('orders', 'billing', 'new', { status: 'added' }), same('f')];
    const text = draw(steps, { context: 1 });
    expect(text).toContain('Note over n_caller,n_billing: 4 unchanged steps');
    expect(text).toContain('n_orders->>n_billing: e');
    expect(text).not.toContain(': b\n');
    expect(foldSteps(steps, 1).map((item) => ('folded' in item ? item.folded : item.step.label))).toEqual(['POST /orders', 4, 'e', 'new', 'f']);
    // A run of one is shown rather than counted, and a walk with nothing marked is never folded.
    expect(foldSteps(steps, 4).some((item) => 'folded' in item)).toBe(false);
    expect(foldSteps(steps.map((item) => ({ ...item, status: 'same' as const })), 0)).toHaveLength(steps.length);
  });

  it('escapes what Mermaid reads as syntax in a label', () => {
    expect(mermaidText('a;b #1 <x> "q" 50%')).toBe('a#59;b #35;1 #lt;x#gt; "q" 50#37;');
    const text = draw([step('caller', 'orders', 'GET /a;b#c', { kind: 'enters' }), step('orders', 'billing', 'say "hi"\nthere')]);
    expect(text).toContain('n_caller->>n_orders: GET /a#59;b#35;c');
    expect(text).toContain('n_orders->>n_billing: say "hi" there');
  });

  it('says a guess is one, draws a stop where the walk stopped, and what the walk left out', () => {
    const text = draw(
      [
        step('caller', 'gateway', 'GET /x', { kind: 'enters' }),
        step('gateway', 'orders', 'GET /maybe', { confidence: 'heuristic' }),
        step('orders', 'orders', 'call-dynamic-receiver', { kind: 'stop' }),
      ],
      { truncated: '3 more nodes past maxNodes 150; raise maxNodes or ask get_flow on a child id', footer: ['unresolved on this path: 1'] },
    );
    expect(text).toContain('n_gateway->>n_orders: GET /maybe (best guess)');
    expect(text).toContain('Note over n_orders: stops here: call-dynamic-receiver');
    expect(text).toContain('Note over n_caller,n_orders: not walked: 3 more nodes past maxNodes 150\n');
    expect(text).toContain('  %% unresolved on this path: 1');
  });

  it('draws a loop body once, and the branches of a Promise.all side by side', () => {
    const loop = { kind: 'loop' as const, id: 'l', label: 'each item (for-of)' };
    const text = draw([
      step('caller', 'orders', 'GET /', { kind: 'enters' }),
      step('orders', 'billing', 'GET /items', { group: loop }),
      step('orders', 'billing', 'GET /a', { group: { kind: 'par', id: 'p', label: 'together', branch: 1 } }),
      step('orders', 'billing', 'GET /b', { group: { kind: 'par', id: 'p', label: 'together', branch: 2 }, status: 'added' }),
    ]);
    expect(text).toContain(
      [
        '  loop each item (for-of)',
        '    n_orders->>n_billing: GET /items',
        '  end',
        '  par together',
        '    n_orders->>n_billing: GET /a',
        '  and together',
        '    rect rgba(46,160,67,0.18)',
        '      n_orders->>n_billing: + GET /b',
        '    end',
        '  end',
      ].join('\n'),
    );
  });
});

describe('the sequence grammar check', () => {
  it('refuses what Mermaid would not read', () => {
    expect(sequenceProblems('sequenceDiagram\n  a->>b: x')).toEqual(['2: a is used before it is declared', '2: b is used before it is declared']);
    expect(sequenceProblems('sequenceDiagram\n  participant a as A\n  a->>a: x; y')).toEqual(['3: a ";" ends the statement']);
    expect(sequenceProblems('sequenceDiagram\n  rect rgba(1,2,3,0.1)\n')).toEqual(['end: rect never closed']);
  });

  it('reads every diagram in the recorded snapshots', () => {
    // The diagrams a reviewer sees, as the snapshot scripts recorded them:
    // one per changed flow of the diff fixture, and `flow --format sequence`.
    const files = [
      join(ROOT, 'fixtures/multi-repo/expected.cli/flow.post-orders.sequence.txt'),
      join(ROOT, 'fixtures/multi-repo-diff/expected.cli/diff.md'),
    ];
    const diagrams = files.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return file.endsWith('.md') ? sequenceBlocksIn(text) : [text];
    });
    expect(diagrams.length).toBeGreaterThan(1);
    for (const diagram of diagrams) expect(sequenceProblems(diagram)).toEqual([]);
  });
});
