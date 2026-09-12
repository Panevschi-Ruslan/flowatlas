import { describe, expect, it } from 'vitest';
import { blastRadius } from './blast-radius.js';
import { edge, node, openTestDb } from './test-graph.js';

/**
 * A button in a browser, a bot press and a channel handler, all reaching one
 * service method. The shape of the plan's own example, small enough to count by
 * hand.
 */
const project = () =>
  openTestDb({
    nodes: [
      node('orders#src/orders.service.ts:OrdersService.create', 'method', { repo: 'orders' }),
      node('entry:orders:http:POST:/orders', 'entry', { repo: 'orders', kind: 'http' }),
      node('orders#src/orders.controller.ts:OrdersController.create', 'method', { repo: 'orders' }),
      node('gateway#src/orders.client.ts:OrdersClient.create', 'http_out', { repo: 'gateway' }),
      node('entry:gateway:http:POST:/orders', 'entry', { repo: 'gateway', kind: 'http' }),
      node('gateway#src/orders.controller.ts:GatewayController.create', 'method', { repo: 'gateway' }),
      node('web#src/checkout.ts:CheckoutComponent.submit', 'ui_action', { repo: 'web', kind: 'click' }),
      node('web#src/checkout.ts:CheckoutComponent.retry', 'ui_action', { repo: 'web', kind: 'click' }),
      node('web#src/orders.api.ts:OrdersApi.create', 'ui_api_call', { repo: 'web' }),
      node('entry:bot:bot_callback:order_confirm', 'entry', { repo: 'bot', kind: 'bot_callback' }),
      node('bot#src/bot.ts:BotUpdate.confirm', 'method', { repo: 'bot' }),
      node('bot#src/orders.client.ts:BotOrders.create', 'http_out', { repo: 'bot' }),
      node('entry:billing:event:order.created', 'entry', { repo: 'billing', kind: 'event' }),
    ],
    edges: [
      edge('entry:orders:http:POST:/orders', 'orders#src/orders.controller.ts:OrdersController.create', {
        type: 'handles',
      }),
      edge(
        'orders#src/orders.controller.ts:OrdersController.create',
        'orders#src/orders.service.ts:OrdersService.create',
      ),
      edge('gateway#src/orders.client.ts:OrdersClient.create', 'entry:orders:http:POST:/orders', {
        type: 'http_calls',
      }),
      edge(
        'gateway#src/orders.controller.ts:GatewayController.create',
        'gateway#src/orders.client.ts:OrdersClient.create',
      ),
      edge('entry:gateway:http:POST:/orders', 'gateway#src/orders.controller.ts:GatewayController.create', {
        type: 'handles',
      }),
      edge('web#src/orders.api.ts:OrdersApi.create', 'entry:gateway:http:POST:/orders', { type: 'hits' }),
      edge('web#src/checkout.ts:CheckoutComponent.submit', 'web#src/orders.api.ts:OrdersApi.create', {
        type: 'triggers',
      }),
      edge('web#src/checkout.ts:CheckoutComponent.retry', 'web#src/orders.api.ts:OrdersApi.create', {
        type: 'triggers',
      }),
      edge('bot#src/orders.client.ts:BotOrders.create', 'entry:orders:http:POST:/orders', {
        type: 'http_calls',
        confidence: 'heuristic',
      }),
      edge('bot#src/bot.ts:BotUpdate.confirm', 'bot#src/orders.client.ts:BotOrders.create'),
      edge('entry:bot:bot_callback:order_confirm', 'bot#src/bot.ts:BotUpdate.confirm', { type: 'handles' }),
      edge('entry:billing:event:order.created', 'orders#src/orders.service.ts:OrdersService.create', {
        type: 'handles',
      }),
    ],
  });

const target = 'orders#src/orders.service.ts:OrdersService.create';

describe('blastRadius', () => {
  it('groups the ways in by service and kind', () => {
    const [row] = blastRadius(project(), [target]).rows;

    expect(row?.counts).toEqual({
      'billing:event': 1,
      'bot:bot_callback': 1,
      'gateway:http': 1,
      'orders:http': 1,
      'web:ui_action': 2,
    });
  });

  it('names every service the chain runs through, the changed node.s own included', () => {
    const [row] = blastRadius(project(), [target]).rows;

    expect(row?.services).toEqual(['billing', 'bot', 'gateway', 'orders', 'web']);
    expect(row?.servicesWithoutEntry).toEqual([]);
    expect(row?.reached).toBe(12);
  });

  it('carries the weakest hop on the way, and the strongest of two ways round', () => {
    const [row] = blastRadius(project(), [target]).rows;
    const found = (id: string) => row?.entries.find((entry) => entry.id === id);

    // Everything from the browser is proven; the bot's request was matched to a
    // route by shape rather than by a setting, so nothing behind it is better
    // than that.
    expect(found('web#src/checkout.ts:CheckoutComponent.submit')?.confidence).toBe('static');
    expect(found('entry:bot:bot_callback:order_confirm')?.confidence).toBe('heuristic');
    // The route itself is reached without crossing the heuristic hop.
    expect(found('entry:orders:http:POST:/orders')?.confidence).toBe('static');
  });

  it('cuts the list at maxEntries and still counts every one of them', () => {
    const radius = blastRadius(project(), [target], { maxEntries: 2 });
    const [row] = radius.rows;

    expect(row?.entries).toHaveLength(2);
    expect(row?.truncated).toBe(4);
    // The counts are of the whole radius, not of the two that were printed.
    expect(Object.values(row?.counts ?? {}).reduce((sum, n) => sum + n, 0)).toBe(6);
  });

  it('lists the nearest way in first, so the top of the list is the closest', () => {
    const [row] = blastRadius(project(), [target], { maxEntries: 1 }).rows;

    expect(row?.entries[0]?.id).toBe('entry:billing:event:order.created');
    expect(row?.entries[0]?.depth).toBe(1);
  });

  it('follows injects backwards from a provider and from nothing else', () => {
    const db = openTestDb({
      nodes: [
        node('orders#src/orders.service.ts:OrdersService', 'provider', { repo: 'orders' }),
        node('orders#src/other.service.ts:OtherService.run', 'method', { repo: 'orders' }),
        node('orders#src/orders.controller.ts:OrdersController', 'provider', { repo: 'orders' }),
        node('entry:orders:http:GET:/orders', 'entry', { repo: 'orders', kind: 'http' }),
        node('orders#src/orders.controller.ts:OrdersController.list', 'method', { repo: 'orders' }),
      ],
      edges: [
        edge(
          'orders#src/orders.controller.ts:OrdersController',
          'orders#src/orders.service.ts:OrdersService',
          { type: 'injects' },
        ),
        edge(
          'orders#src/orders.controller.ts:OrdersController',
          'orders#src/other.service.ts:OtherService.run',
          { type: 'injects' },
        ),
        edge('entry:orders:http:GET:/orders', 'orders#src/orders.controller.ts:OrdersController.list', {
          type: 'handles',
        }),
        edge(
          'orders#src/orders.controller.ts:OrdersController.list',
          'orders#src/orders.controller.ts:OrdersController',
          { type: 'calls' },
        ),
      ],
    });

    const provider = blastRadius(db, ['orders#src/orders.service.ts:OrdersService']).rows[0];
    const method = blastRadius(db, ['orders#src/other.service.ts:OtherService.run']).rows[0];

    expect(provider?.counts).toEqual({ 'orders:http': 1 });
    // The same holder, reached by the same `injects` edge — but the changed
    // node is a method, so the walk never follows one.
    expect(method?.counts).toEqual({});
    expect(method?.reached).toBe(0);
  });

  it('says so when the chain stops in a service without reaching a way in', () => {
    const db = openTestDb({
      nodes: [
        node('orders#a.ts:A.one', 'method', { repo: 'orders' }),
        node('gateway#b.ts:B.two', 'method', { repo: 'gateway' }),
      ],
      edges: [edge('gateway#b.ts:B.two', 'orders#a.ts:A.one')],
    });

    const [row] = blastRadius(db, ['orders#a.ts:A.one']).rows;

    expect(row?.entries).toEqual([]);
    expect(row?.reached).toBe(1);
    expect(row?.servicesWithoutEntry).toEqual(['gateway']);
  });

  it('answers about a node the graph does not hold, rather than throwing', () => {
    const [row] = blastRadius(project(), ['orders#gone.ts:Gone.away']).rows;

    expect(row?.entries).toEqual([]);
    expect(row?.reached).toBe(0);
    expect(row?.label).toBe('orders#gone.ts:Gone.away');
  });

  it('says the walk was cut rather than pretending the count is a total', () => {
    const [row] = blastRadius(project(), [target], { maxWalk: 3 }).rows;

    expect(row?.partial).toBe(true);
  });

  it('labels which graph it walked, so a removed node is not read as a live one', () => {
    const [row] = blastRadius(project(), [target], { side: 'base' }).rows;

    expect(row?.side).toBe('base');
  });
});
