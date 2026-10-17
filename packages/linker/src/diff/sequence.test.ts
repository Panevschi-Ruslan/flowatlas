import { describe, expect, it } from 'vitest';
import {
  diffSequences,
  flowChangeOf,
  sayCounts,
  sayStep,
  sequenceOf,
  servicesCrossed,
  siteOfEdge,
  stepKeyOf,
  typeNotesOf,
  type Sequence,
  type SequenceSite,
  type SequenceStep,
  type SequenceTree,
} from './sequence.js';

type Node = SequenceTree['node'];

const row = (node: Node, edge: SequenceTree['edge'] | undefined, children: SequenceTree[] = []): SequenceTree => ({
  node,
  ...(edge === undefined ? {} : { edge }),
  children,
});
const by = (type: string, extra: Partial<NonNullable<SequenceTree['edge']>> = {}): SequenceTree['edge'] => ({ type, confidence: 'static', ...extra });

/**
 * A bookshop's `POST /orders`: the controller hands to the service, which
 * writes the order, publishes `order.created` (billing takes it) and asks
 * billing for an invoice.
 */
const ordersFlow = (): SequenceTree =>
  row({ id: 'entry:orders:http:POST:/orders', type: 'entry', kind: 'http', label: 'POST /orders', service: 'orders', loc: 'src/orders.controller.ts:10' }, undefined, [
    row({ id: 'orders#c:OrdersController.create', type: 'method', label: 'OrdersController.create', service: 'orders' }, by('handles', { params: ['type:orders#CreateOrderDto'] }), [
      row({ id: 'orders#s:OrdersService.create', type: 'method', label: 'OrdersService.create', service: 'orders' }, by('calls'), [
        row({ id: 'db_query:orders#s:20', type: 'db_query', label: 'write orders', service: 'orders', loc: 'src/orders.service.ts:20' }, by('calls'), [
          row({ id: 'table:orders#orders', type: 'table', label: 'orders', service: 'orders' }, by('queries')),
        ]),
        row({ id: 'producer:orders#s:22', type: 'producer', label: 'event order.created', service: 'orders', loc: 'src/orders.service.ts:22' }, by('calls'), [
          row({ id: 'channel:order.created', type: 'channel', label: 'order.created', service: 'orders', meta: { channelKind: 'topic' } }, by('emits', { params: ['type:orders#OrderDto'] }), [
            row({ id: 'consumer:billing#c:InvoicesConsumer.on', type: 'consumer', label: 'InvoicesConsumer.on', service: 'billing' }, by('consumes'), [
              row({ id: 'billing#c:InvoicesConsumer.on', type: 'method', label: 'InvoicesConsumer.on', service: 'billing' }, by('calls')),
            ]),
          ]),
        ]),
        row({ id: 'http_out:orders#s:30', type: 'http_out', label: 'POST /invoices', service: 'orders', loc: 'src/orders.service.ts:30' }, by('calls'), [
          row({ id: 'entry:billing:http:POST:/invoices', type: 'entry', kind: 'http', label: 'POST /invoices', service: 'billing' }, by('http_calls'), [
            row({ id: 'billing#i:InvoicesController.create', type: 'method', label: 'InvoicesController.create', service: 'billing' }, by('handles')),
          ]),
        ]),
      ]),
    ]),
  ]);

const lines = (sequence: Sequence): string[] => sequence.steps.map((step) => sayStep(step, sequence.participants));

describe('sequenceOf (P116)', () => {
  it('reads a walk as the steps that cross from one participant to another, in call order', () => {
    const sequence = sequenceOf(ordersFlow());
    expect(lines(sequence)).toEqual([
      'client → orders POST /orders',
      'orders → orders (table) write orders',
      'orders → order.created (topic) order.created',
      'order.created (topic) → billing order.created',
      'orders → billing POST /invoices',
    ]);
    // The request into the way in carries the body the handler takes.
    expect(sequence.steps[0]).toMatchObject({ kind: 'enters', params: ['type:orders#CreateOrderDto'], file: 'src/orders.controller.ts', line: 10 });
    // A crossing is placed where its call is written.
    expect(sequence.steps[4]).toMatchObject({ kind: 'http_calls', file: 'src/orders.service.ts', line: 30 });
  });

  it('makes a channel a participant of its own and a table one under its service', () => {
    const { participants } = sequenceOf(ordersFlow());
    expect(participants).toEqual([
      { id: 'caller', label: 'client', kind: 'caller' },
      { id: 'orders', label: 'orders', kind: 'service', service: 'orders' },
      { id: 'table:orders/orders', label: 'orders (table)', kind: 'table', service: 'orders' },
      { id: 'channel:order.created', label: 'order.created (topic)', kind: 'channel' },
      { id: 'billing', label: 'billing', kind: 'service', service: 'billing' },
    ]);
  });

  it('draws the classes inside a service at class detail, and a call between them', () => {
    const sequence = sequenceOf(ordersFlow(), { detail: 'class' });
    expect(lines(sequence).slice(0, 3)).toEqual([
      'client → OrdersController POST /orders',
      'OrdersController → OrdersService OrdersService.create',
      'OrdersService → orders (table) write orders',
    ]);
    expect(sequence.participants.find((participant) => participant.id === 'billing/InvoicesController')).toEqual({
      id: 'billing/InvoicesController',
      label: 'InvoicesController',
      kind: 'class',
      service: 'billing',
    });
  });

  it('orders siblings by the call order: what runs as written by line, then what a workflow orders', () => {
    const sites = new Map<string, SequenceSite>([
      ['a', { line: 30 }],
      ['b', { line: 12 }],
      ['c', { order: 1, line: 5 }],
    ]);
    const call = (id: string): SequenceTree =>
      row({ id, type: 'http_out', label: `GET /${id}`, service: 'web' }, by('calls'), [
        row({ id: `entry:${id}`, type: 'entry', label: `GET /${id}`, service: 'api' }, by('http_calls')),
      ]);
    const tree = row({ id: 'entry:web', type: 'entry', label: 'GET /', service: 'web' }, undefined, [call('c'), call('a'), call('b')]);
    const sequence = sequenceOf(tree, { siteOf: (item) => sites.get(item.node.id) });
    expect(sequence.steps.map((step) => step.label)).toEqual(['GET /', 'GET /b', 'GET /a', 'GET /c']);
  });

  it('keeps a loop and a Promise.all as groups, and one step for the same message repeated in a loop', () => {
    const call = (id: string, path: string): SequenceTree =>
      row({ id, type: 'http_out', label: `GET ${path}`, service: 'web' }, by('calls'), [
        row({ id: `entry:${path}`, type: 'entry', label: `GET ${path}`, service: 'api' }, by('http_calls')),
      ]);
    const tree = row({ id: 'entry:web', type: 'entry', label: 'GET /', service: 'web' }, undefined, [
      call('l1', '/items'),
      call('l2', '/items'),
      call('p1', '/a'),
      call('p2', '/b'),
    ]);
    const sites: Record<string, SequenceSite> = {
      l1: { line: 3, loop: { kind: 'for-of', line: 2 } },
      l2: { line: 4, loop: { kind: 'for-of', line: 2 } },
      p1: { line: 8, concurrent: true, together: 8 },
      p2: { line: 8, concurrent: true, together: 8 },
    };
    const sequence = sequenceOf(tree, { siteOf: (item) => sites[item.node.id] });
    const [, loop, a, b] = sequence.steps as SequenceStep[];
    expect(sequence.steps).toHaveLength(4);
    expect(loop?.group).toEqual({ kind: 'loop', id: 'entry:web|loop|for-of|2', label: 'each item (for-of)' });
    expect(a?.group).toMatchObject({ kind: 'par', id: 'entry:web|par|8', branch: 2 });
    expect(b?.group).toMatchObject({ kind: 'par', id: 'entry:web|par|8', branch: 3 });
  });

  it('draws a place the walk cannot see past as a stop where it stopped, never leaves it out (I3)', () => {
    const tree = row({ id: 'entry:gw', type: 'entry', kind: 'http', label: 'GET /x', service: 'gateway' }, undefined, [
      row({ id: 'http_out:gw', type: 'http_out', label: 'GET /old', service: 'gateway', loc: 'src/client.ts:9' }, by('calls')),
      row({ id: 'missing:1', type: 'missing', label: 'missing:1' }, by('calls')),
    ]);
    const sequence = sequenceOf(tree, { stopOf: (item) => (item.node.id === 'http_out:gw' ? 'target-route-not-found' : undefined) });
    expect(lines(sequence)).toEqual([
      'client → gateway GET /x',
      'gateway stops here: target-route-not-found',
      'gateway stops here: not in the graph',
    ]);
    expect(sequence.steps[1]).toMatchObject({ kind: 'stop', from: 'gateway', to: 'gateway', file: 'src/client.ts', line: 9 });
  });

  it('keeps every confidence, and says a guess is one', () => {
    const tree = row({ id: 'entry:web', type: 'entry', label: 'GET /', service: 'web' }, undefined, [
      row({ id: 'http_out:w', type: 'http_out', label: 'GET /maybe', service: 'web' }, by('calls'), [
        row({ id: 'entry:api', type: 'entry', label: 'GET /maybe', service: 'api' }, by('http_calls', { confidence: 'heuristic' })),
      ]),
    ]);
    const sequence = sequenceOf(tree);
    expect(sequence.steps[1]?.confidence).toBe('heuristic');
    expect(lines(sequence)[1]).toBe('web → api GET /maybe (best guess)');
  });

  it('reads a graph edge for its site the way the Steps view does', () => {
    expect(
      siteOfEdge({
        from: 'a',
        to: 'b',
        type: 'calls',
        confidence: 'static',
        file: 'src/a.ts',
        line: 4,
        meta: { inLoop: { kind: 'map', line: 3 }, concurrent: true, together: { by: 'Promise.all', line: 3 } },
      }),
    ).toEqual({ file: 'src/a.ts', line: 4, loop: { kind: 'map', line: 3 }, concurrent: true, together: 3 });
  });
});

const step = (label: string, extra: Partial<SequenceStep> = {}): SequenceStep => ({
  kind: 'http_calls',
  from: 'orders',
  to: 'billing',
  label,
  confidence: 'static',
  ...extra,
});
const seq = (...steps: SequenceStep[]): Sequence => ({
  participants: [
    { id: 'orders', label: 'orders', kind: 'service', service: 'orders' },
    { id: 'billing', label: 'billing', kind: 'service', service: 'billing' },
  ],
  steps,
});
const statuses = (changes: { status: string; label: string }[]): string[] => changes.map((change) => `${change.status} ${change.label}`);

describe('diffSequences (P116)', () => {
  it('sees a step inserted in the middle as one addition, not a cascade', () => {
    const { steps } = diffSequences(seq(step('A'), step('B'), step('C')), seq(step('A'), step('X'), step('B'), step('C')));
    expect(statuses(steps)).toEqual(['same A', 'added X', 'same B', 'same C']);
  });

  it('sees a step deleted as one removal, read off the base', () => {
    const { steps } = diffSequences(seq(step('A'), step('B', { line: 7 }), step('C')), seq(step('A'), step('C')));
    expect(statuses(steps)).toEqual(['same A', 'removed B', 'same C']);
    expect(steps[1]?.line).toBe(7);
  });

  it('calls a step that only moved lines the same step (D2)', () => {
    const { steps } = diffSequences(seq(step('A', { line: 3 }), step('B', { line: 9 })), seq(step('A', { line: 8 }), step('B', { line: 14 })));
    expect(statuses(steps)).toEqual(['same A', 'same B']);
    expect(steps[0]?.line).toBe(8);
  });

  it('marks a step changed when what it carries, a type it carries, or its confidence changed', () => {
    const notes = typeNotesOf([
      {
        id: 'type:orders#CreateOrderDto',
        name: 'CreateOrderDto',
        baseHash: 'a',
        headHash: 'b',
        fieldDiff: [{ field: 'channel', change: 'added', optional: false, base: null, head: 'string', rule: null, message: 'added' }],
      },
    ]);
    const { steps } = diffSequences(
      seq(step('A', { params: ['type:orders#CreateOrderDto'] }), step('B', { params: ['type:x#Old'] }), step('C', { confidence: 'heuristic' })),
      seq(step('A', { params: ['type:orders#CreateOrderDto'] }), step('B', { params: ['type:x#New'] }), step('C')),
      { typeNotes: notes },
    );
    expect(steps.map((item) => [item.status, item.note])).toEqual([
      ['changed', 'body: +channel (required)'],
      ['changed', 'body: Old → New'],
      ['changed', 'confidence: heuristic → static'],
    ]);
  });

  it('reads a reorder as a step removed and added, since the order is what changed', () => {
    const { steps } = diffSequences(seq(step('A'), step('B')), seq(step('B'), step('A')));
    expect(statuses(steps)).toEqual(['removed A', 'same B', 'added A']);
  });

  it('keys a step by its meaning: kind, both ends and label', () => {
    expect(stepKeyOf(step('A'))).not.toBe(stepKeyOf(step('A', { kind: 'hits' })));
    expect(stepKeyOf(step('A', { line: 1 }))).toBe(stepKeyOf(step('A', { line: 2 })));
  });
});

describe('flowChangeOf (P116)', () => {
  const entry = { id: 'entry:orders:http:POST:/orders', label: 'POST /orders', service: 'orders', reaches: 2 };

  it('compares the sides that have the way in, and counts what changed', () => {
    const flow = flowChangeOf(entry, { base: { sequence: seq(step('A')) }, head: { sequence: seq(step('A'), step('B')), truncated: '3 more nodes' } });
    expect(flow).toMatchObject({ side: 'both', counts: { same: 1, added: 1, removed: 0, changed: 0 }, truncated: '3 more nodes' });
    expect(sayCounts(flow!.counts)).toBe('1 step added');
    expect(servicesCrossed(flow!)).toEqual(['orders', 'billing']);
  });

  it('draws a way in only one side has as all added or all removed', () => {
    expect(flowChangeOf(entry, { head: { sequence: seq(step('A')) } })).toMatchObject({ side: 'head', counts: { added: 1 } });
    expect(flowChangeOf(entry, { base: { sequence: seq(step('A'), step('B')) } })).toMatchObject({ side: 'base', counts: { removed: 2 } });
    expect(sayCounts({ same: 0, added: 0, removed: 2, changed: 1 })).toBe('2 steps removed, 1 changed');
    expect(flowChangeOf(entry, {})).toBeUndefined();
  });
});
