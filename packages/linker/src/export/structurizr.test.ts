import { describe, expect, it } from 'vitest';
import type { Sequence, SequenceStep } from '../diff/sequence.js';
import { bookshop, SERVICES } from './__fixtures__/bookshop.js';
import { dslProblems } from './checks.js';
import { channelGroupOf, dslString, exportStructurizr, type ExportFlow } from './structurizr.js';

const step = (kind: SequenceStep['kind'], from: string, to: string, label: string, confidence: SequenceStep['confidence'] = 'static'): SequenceStep => ({ kind, from, to, label, confidence });

const participants: Sequence['participants'] = [
  { id: 'caller', label: 'client', kind: 'caller' },
  { id: 'gateway', label: 'gateway', kind: 'service', service: 'gateway' },
  { id: 'orders', label: 'orders', kind: 'service', service: 'orders' },
  { id: 'billing', label: 'billing', kind: 'service', service: 'billing' },
  { id: 'table:orders/orders', label: 'orders (table)', kind: 'table', service: 'orders' },
  { id: 'channel:order.created', label: 'order.created (topic)', kind: 'channel' },
];

/** The gateway's GET walked through orders to its table, then a publish billing takes, then a guess. */
const throughOrders: ExportFlow = {
  entry: 'entry:gateway:http:GET:/orders/:param',
  label: 'GET /orders/:param',
  service: 'gateway',
  sequence: {
    participants,
    steps: [
      step('enters', 'caller', 'gateway', 'GET /orders/:param'),
      step('http_calls', 'gateway', 'orders', 'GET /orders/:param', 'marker'),
      step('queries', 'orders', 'table:orders/orders', 'read orders'),
      step('emits', 'orders', 'channel:order.created', 'order.created'),
      step('consumes', 'channel:order.created', 'billing', 'order.created'),
      step('http_calls', 'gateway', 'billing', 'POST /invoices', 'heuristic'),
    ],
  },
};

/** A way in that never leaves its service. */
const staysHome: ExportFlow = {
  entry: 'entry:orders:http:POST:/orders',
  label: 'POST /orders',
  service: 'orders',
  sequence: { participants, steps: [step('enters', 'caller', 'orders', 'POST /orders')] },
};

/** Orders to its own table only: one crossing, ranked below the one that crosses three services. */
const toTable: ExportFlow = {
  entry: 'entry:orders:http:GET:/orders/:param',
  label: 'GET /orders/:param',
  service: 'orders',
  sequence: { participants, steps: [step('enters', 'caller', 'orders', 'GET /orders/:param'), step('queries', 'orders', 'table:orders/orders', 'read orders')] },
};

describe('exportStructurizr (P119)', () => {
  const run = exportStructurizr(bookshop(), { services: SERVICES, project: 'bookshop', flows: [staysHome, toTable, throughOrders] });
  const dsl = run.files[0]!.text;

  it('draws a container per service, a store per service with tables, a queue per channel prefix, and the hosts outside', () => {
    expect(run.model.elements.map((each) => `${each.kind} ${each.id} ${each.name}`)).toEqual([
      'container Sales_Ledger Sales Ledger',
      'container billing billing',
      'container gateway gateway',
      'container jobs jobs',
      'container orders orders',
      'container web web',
      'container billing_store billing store',
      'container orders_store orders store',
      'container invoice_messages invoice messages',
      'container order_messages order messages',
      'softwareSystem pay_example_com pay.example.com',
      'person user User',
    ]);
    expect(dsl).toContain('orders = container "orders" "Takes orders." "nestjs"');
    expect(dsl).toContain('billing_store = container "billing store" "invoices, orders" "" "Database"');
    expect(dsl).toContain('order_messages = container "order messages" "order.created, order.shipped" "" "Queue"');
    expect(dsl).toContain('pay_example_com = softwareSystem "pay.example.com" "Outside the project; called from the code." "External"');
    expect(dsl).toContain('user = person "User"');
  });

  it('writes one relationship per pair and kind, described by what crosses it', () => {
    expect(run.model.relationships.map((each) => `${each.from} -> ${each.to}: ${each.description} [${each.technology}]`)).toEqual([
      'billing -> billing_store: reads invoices, writes orders [SQL]',
      'billing -> jobs: invokes nightly-report [Invoke]',
      'gateway -> orders: GET /orders/:param [HTTP]',
      'gateway -> pay_example_com: POST /v1/charges [HTTP]',
      'invoice_messages -> billing: delivers invoice.requested [Messaging]',
      'order_messages -> billing: delivers order.created [Messaging]',
      'orders -> order_messages: publishes order.created, order.shipped [Messaging]',
      'orders -> orders_store: reads and writes orders [SQL]',
      'user -> web: Uses [HTTPS]',
      'web -> gateway: GET /orders/:param [HTTP]',
    ]);
    expect(run.summary.heuristic).toEqual({ drawn: 0, leftOut: 2 });
  });

  it('collapses a relationship past --max-labels, saying how many more', () => {
    const tight = exportStructurizr(bookshop(), { services: SERVICES, project: 'bookshop', maxLabels: 1 });
    expect(tight.model.relationships.find((each) => each.from === 'orders' && each.to === 'order_messages')?.description).toBe('publishes order.created +1 more');
    expect(tight.summary.collapsed).toBe(2);
  });

  it('draws a dynamic view per flow in call order, crossing containers only, only on relationships of the model', () => {
    const [first, second] = run.model.views;
    expect(first?.entry).toBe(throughOrders.entry);
    expect(first?.steps.map((each) => `${each.from} -> ${each.to}: ${each.description}`)).toEqual([
      'gateway -> orders: GET /orders/:param',
      'orders -> orders_store: reads orders',
      'orders -> order_messages: publishes order.created',
      'order_messages -> billing: delivers order.created',
    ]);
    expect(second?.entry).toBe(toTable.entry);
    expect(run.model.views).toHaveLength(2);
    // The guess has no relationship of the model under it; the caller of a server route is nobody the model holds.
    expect(run.summary.stepsCut).toBe(1);
    expect(run.summary.flows).toEqual({ drawn: 2, cut: 0, nothingCrosses: 1, repeated: 0 });
  });

  it('bounds the views by --max-flows and counts the rest, and draws the named flows in the order given', () => {
    const bounded = exportStructurizr(bookshop(), { services: SERVICES, project: 'bookshop', flows: [toTable, throughOrders], maxFlows: 1 });
    expect(bounded.model.views.map((view) => view.entry)).toEqual([throughOrders.entry]);
    expect(bounded.summary.flows.cut).toBe(1);
    const named = exportStructurizr(bookshop(), { services: SERVICES, project: 'bookshop', flows: [toTable, throughOrders], asked: true, maxFlows: 1 });
    expect(named.model.views.map((view) => view.entry)).toEqual([toTable.entry, throughOrders.entry]);
  });

  it('draws one view for two ways in that draw the same steps', () => {
    const twice = exportStructurizr(bookshop(), { services: SERVICES, project: 'bookshop', flows: [toTable, { ...toTable, entry: 'entry:orders:invoke:read-order', label: 'read-order' }] });
    expect(twice.model.views).toHaveLength(1);
    expect(twice.summary.flows.repeated).toBe(1);
  });

  it('draws a heuristic join only when asked, tagged', () => {
    const asked = exportStructurizr(bookshop(), { services: SERVICES, project: 'bookshop', includeHeuristic: true, flows: [throughOrders] });
    expect(asked.files[0]!.text).toContain('order_messages -> gateway "delivers order.shipped" "Messaging" "Heuristic"');
    expect(asked.files[0]!.text).toContain('web -> orders "POST /orders" "HTTP" "Heuristic"');
    expect(asked.summary.heuristic.drawn).toBe(2);
  });

  it('escapes quotes and keeps identifiers apart from the DSL keywords, and the workspace holds to the DSL', () => {
    const odd = exportStructurizr(bookshop(), { services: [...SERVICES, { name: 'model', type: 'nestjs' }], project: 'the "shop"' });
    expect(odd.files[0]!.text).toContain('workspace "the \\"shop\\""');
    expect(odd.files[0]!.text).toContain('model_ = container "model"');
    expect(dslString('a "b" \\ c\nd')).toBe('"a \\"b\\" \\\\ c d"');
    expect(dslProblems(dsl)).toEqual([]);
    expect(dslProblems(odd.files[0]!.text)).toEqual([]);
  });

  it('keeps only the joins of the services asked for, and what they touch', () => {
    const one = exportStructurizr(bookshop(), { services: SERVICES, project: 'bookshop', only: ['billing'] });
    expect(one.model.elements.filter((each) => each.kind === 'container').map((each) => each.id)).toEqual(['billing', 'jobs', 'orders', 'billing_store', 'invoice_messages', 'order_messages']);
  });

  it('groups channels by everything before the last separator', () => {
    expect(channelGroupOf('order.created')).toBe('order');
    expect(channelGroupOf('bus/library/library.loans/LoanCreated')).toBe('bus/library/library.loans');
    expect(channelGroupOf('payments')).toBe('payments');
  });

  it('writes the same bytes whatever order the graph comes in', () => {
    const graph = bookshop();
    const again = exportStructurizr({ nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() }, { services: [...SERVICES].reverse(), project: 'bookshop', flows: [staysHome, toTable, throughOrders] });
    expect(again.files).toEqual(run.files);
  });
});

describe('dslProblems', () => {
  it('names a step with no relationship under it, an identifier used before it is defined, and an unclosed block', () => {
    const text = ['workspace "w" "d" {', '  model {', '    s = softwareSystem "s" {', '      a = container "a" "" ""', '    }', '    a -> b "x" "HTTP"', '  }', '  views {', '    dynamic s "k" "d" {', '      a -> a "x" "HTTP"', '    }', '  }'].join('\n');
    expect(dslProblems(text)).toEqual([
      'line 6: b is not defined above: a -> b "x" "HTTP"',
      'line 10: no relationship of the model from a to a: a -> a "x" "HTTP"',
      '1 block(s) not closed: workspace',
    ]);
  });
});
