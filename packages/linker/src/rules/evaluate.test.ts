import type { Confidence, GraphEdge, GraphNode, RuleConfig } from '@flowatlas/core';
import { ruleSchema } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { evaluateRules, ruleFailures, ruleKeyOf } from './evaluate.js';
import type { RuleGraph } from './types.js';

const node = (id: string, type: string, repo: string, label: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id,
  type,
  repo,
  label,
  file: `src/${label.replace(/\W+/g, '-')}.ts`,
  line: 10,
  ...extra,
} as GraphNode);

const edge = (from: string, type: string, to: string, confidence: Confidence = 'static'): GraphEdge => ({ from, to, type, confidence } as GraphEdge);

/**
 * A bookshop: a browser (`web`), its gateway, `orders` and `billing`. The
 * browser asks the gateway and, once, `orders` straight; the gateway calls
 * `orders`; `orders` writes its table and publishes `order.created`, which
 * `billing` and the gateway consume; `billing` writes `orders`' table too.
 */
const shop = (): RuleGraph => ({
  nodes: [
    node('ui:web#checkout', 'ui_api_call', 'web', 'GET /orders/:param'),
    node('ui:web#direct', 'ui_api_call', 'web', 'GET /orders/:param direct'),
    node('entry:gateway:http:GET:/orders/:param', 'entry', 'gateway', 'GET /orders/:param', { kind: 'http' }),
    node('gateway#OrdersController.get', 'method', 'gateway', 'OrdersController.get'),
    node('http_out:gateway#orders', 'http_out', 'gateway', 'GET /orders/:param'),
    node('consumer:gateway#audit', 'consumer', 'gateway', 'AuditConsumer.onOrderCreated'),
    node('entry:orders:http:GET:/orders/:param', 'entry', 'orders', 'GET /orders/:param', { kind: 'http' }),
    node('orders#OrdersService.find', 'method', 'orders', 'OrdersService.find'),
    node('db_query:orders#save', 'db_query', 'orders', 'write orders', { meta: { op: 'write' } }),
    node('table:orders#orders', 'table', 'orders', 'orders'),
    node('producer:orders#created', 'producer', 'orders', 'order.created'),
    node('channel:order.created', 'channel', 'orders', 'order.created'),
    node('consumer:billing#created', 'consumer', 'billing', 'InvoicesConsumer.onOrderCreated'),
    node('billing#InvoicesService.open', 'method', 'billing', 'InvoicesService.open'),
    node('db_query:billing#mark', 'db_query', 'billing', 'write orders', { meta: { op: 'write' } }),
    node('table:billing#orders', 'table', 'billing', 'orders'),
  ],
  edges: [
    edge('ui:web#checkout', 'hits', 'entry:gateway:http:GET:/orders/:param'),
    edge('ui:web#direct', 'hits', 'entry:orders:http:GET:/orders/:param', 'heuristic'),
    edge('entry:gateway:http:GET:/orders/:param', 'handles', 'gateway#OrdersController.get'),
    edge('gateway#OrdersController.get', 'calls', 'http_out:gateway#orders'),
    edge('http_out:gateway#orders', 'http_calls', 'entry:orders:http:GET:/orders/:param', 'marker'),
    edge('entry:orders:http:GET:/orders/:param', 'handles', 'orders#OrdersService.find'),
    edge('orders#OrdersService.find', 'calls', 'db_query:orders#save'),
    edge('db_query:orders#save', 'queries', 'table:orders#orders'),
    edge('orders#OrdersService.find', 'calls', 'producer:orders#created'),
    edge('producer:orders#created', 'emits', 'channel:order.created'),
    edge('channel:order.created', 'consumes', 'consumer:billing#created'),
    edge('channel:order.created', 'consumes', 'consumer:gateway#audit'),
    edge('consumer:billing#created', 'calls', 'billing#InvoicesService.open'),
    edge('billing#InvoicesService.open', 'calls', 'db_query:billing#mark'),
    edge('db_query:billing#mark', 'queries', 'table:billing#orders'),
  ],
  tags: { web: ['frontend'], gateway: ['edge'], orders: ['domain'], billing: ['domain'] },
});

/**
 * Payments, kept by billing through a workflow (`settle`) it starts. orders
 * starts the same workflow too, behind the gateway; `reports` writes and
 * reads the table itself.
 */
const payments = (): RuleGraph => ({
  nodes: [
    node('entry:billing:http:POST:/charges', 'entry', 'billing', 'POST /charges', { kind: 'http' }),
    node('billing#Charges.charge', 'method', 'billing', 'Charges.charge'),
    node('start:billing#settle', 'start', 'billing', 'start settle'),
    node('entry:gateway:http:POST:/orders', 'entry', 'gateway', 'POST /orders', { kind: 'http' }),
    node('gateway#Orders.place', 'method', 'gateway', 'Orders.place'),
    node('http_out:gateway#orders', 'http_out', 'gateway', 'POST /orders'),
    node('entry:orders:http:POST:/orders', 'entry', 'orders', 'POST /orders', { kind: 'http' }),
    node('orders#Orders.place', 'method', 'orders', 'Orders.place'),
    node('start:orders#settle', 'start', 'orders', 'start settle'),
    node('entry:settle:workflow', 'entry', 'settle', 'settle', { kind: 'workflow' }),
    node('settle#Settle.run', 'method', 'settle', 'Settle.run'),
    node('db_query:settle#save', 'db_query', 'settle', 'write payments', { meta: { op: 'write' } }),
    node('table:settle#payments', 'table', 'settle', 'payments'),
    node('reports#Fix.run', 'method', 'reports', 'Fix.run'),
    node('db_query:reports#fix', 'db_query', 'reports', 'write payments', { meta: { op: 'write' } }),
    node('db_query:reports#list', 'db_query', 'reports', 'read payments', { meta: { op: 'read' } }),
  ],
  edges: [
    edge('entry:billing:http:POST:/charges', 'handles', 'billing#Charges.charge'),
    edge('billing#Charges.charge', 'calls', 'start:billing#settle'),
    edge('start:billing#settle', 'triggers', 'entry:settle:workflow'),
    edge('entry:gateway:http:POST:/orders', 'handles', 'gateway#Orders.place'),
    edge('gateway#Orders.place', 'calls', 'http_out:gateway#orders'),
    edge('http_out:gateway#orders', 'http_calls', 'entry:orders:http:POST:/orders'),
    edge('entry:orders:http:POST:/orders', 'handles', 'orders#Orders.place'),
    edge('orders#Orders.place', 'calls', 'start:orders#settle'),
    edge('start:orders#settle', 'triggers', 'entry:settle:workflow', 'heuristic'),
    edge('entry:settle:workflow', 'handles', 'settle#Settle.run'),
    edge('settle#Settle.run', 'calls', 'db_query:settle#save'),
    edge('db_query:settle#save', 'queries', 'table:settle#payments'),
    edge('reports#Fix.run', 'calls', 'db_query:reports#fix'),
    edge('reports#Fix.run', 'calls', 'db_query:reports#list'),
    edge('db_query:reports#fix', 'queries', 'table:settle#payments'),
    edge('db_query:reports#list', 'queries', 'table:settle#payments'),
  ],
  tags: {},
});

const rule = (written: Record<string, unknown>): RuleConfig => ruleSchema.parse(written);

describe('evaluateRules (P114)', () => {
  it('forbid, direct: one hop between the two sides, at the near end', () => {
    const report = evaluateRules(shop(), [rule({ name: 'web-not-orders', forbid: { from: { service: 'web' }, to: { service: 'orders' } } })]);
    expect(report.violations.map((item) => [item.from, item.to, item.via])).toEqual([
      ['ui:web#direct', 'entry:orders:http:GET:/orders/:param', 'hits'],
    ]);
    const [found] = report.violations;
    expect(found?.at).toEqual({ service: 'web', file: 'src/GET-orders-param-direct.ts', line: 10 });
    expect(found?.key).toBe(ruleKeyOf('web-not-orders', 'ui:web#direct', 'entry:orders:http:GET:/orders/:param'));
    expect(report.rules[0]).toMatchObject({ status: 'broken', violations: 1, matched: { from: 2, to: 5 } });
  });

  it('keys a violation without a line, so a moved call is the same violation (D5)', () => {
    const graph = shop();
    const moved: RuleGraph = {
      ...graph,
      nodes: graph.nodes.map((item) => (item.id === 'ui:web#direct' ? { ...item, id: 'ui_api_call:web#src/a.ts:40:3' } : item)),
      edges: graph.edges.map((item) => (item.from === 'ui:web#direct' ? { ...item, from: 'ui_api_call:web#src/a.ts:40:3' } : item)),
    };
    const lower: RuleGraph = {
      ...moved,
      nodes: moved.nodes.map((item) => (item.id === 'ui_api_call:web#src/a.ts:40:3' ? { ...item, id: 'ui_api_call:web#src/a.ts:52:3' } : item)),
      edges: moved.edges.map((item) => (item.from === 'ui_api_call:web#src/a.ts:40:3' ? { ...item, from: 'ui_api_call:web#src/a.ts:52:3' } : item)),
    };
    const written = [rule({ name: 'web-not-orders', forbid: { from: { service: 'web' }, to: { service: 'orders' } } })];
    const before = evaluateRules(moved, written).violations[0]?.key;
    expect(before).toBe('rule|web-not-orders|ui_api_call:web#src/a.ts~GET /orders/:param direct|entry:orders:http:GET:/orders/:param');
    expect(evaluateRules(lower, written).violations[0]?.key).toBe(before);
  });

  it('forbid, transitive: through the gateway, stopping where the path enters the other side', () => {
    // One path per node reached, the shortest: without the direct request, the one through the gateway.
    const graph = shop();
    const report = evaluateRules({ ...graph, edges: graph.edges.filter((item) => item.from !== 'ui:web#direct') }, [
      rule({ name: 'web-never-orders', forbid: { from: { service: 'web' }, to: { service: 'orders' }, reach: 'transitive' } }),
    ]);
    const through = report.violations.find((item) => item.from === 'ui:web#checkout');
    expect(through?.to).toBe('entry:orders:http:GET:/orders/:param');
    expect(through?.path.map((hop) => hop.type)).toEqual(['hits', 'handles', 'calls', 'http_calls']);
    // The weakest hop on the path (I4), and the crossing is the first one that crosses.
    expect(through?.confidence).toBe('marker');
    expect(through?.via).toBe('hits');
  });

  it('forbid, transitive: through a channel, from the nearest node of the side to the consumer', () => {
    const report = evaluateRules(shop(), [
      rule({ name: 'orders-never-billing', forbid: { from: { service: 'orders' }, to: { service: 'billing' }, reach: 'transitive' } }),
    ]);
    expect(report.violations.map((item) => [item.to, item.path.map((hop) => hop.type).join(' ')])).toEqual([
      ['consumer:billing#created', 'emits consumes'],
    ]);
  });

  it('only: a write from outside the owner breaks it; the owner\'s own writes pass', () => {
    const report = evaluateRules(shop(), [
      rule({ name: 'only-orders-writes-orders', only: { from: { service: 'orders' }, to: { table: 'orders' }, op: 'write' } }),
    ]);
    expect(report.violations.map((item) => [item.from, item.to, item.via])).toEqual([['db_query:billing#mark', 'table:billing#orders', 'queries']]);
    expect(report.violations[0]?.message).toBe('billing writes table orders (billing), which only service orders may');
  });

  it('only: a consume of a channel by anyone else breaks it, read as the handler depending on the channel', () => {
    const report = evaluateRules(shop(), [
      rule({ name: 'only-billing-consumes', only: { from: { service: 'billing' }, to: { channel: 'order.*' }, via: ['consumes'] } }),
    ]);
    expect(report.violations.map((item) => [item.from, item.to, item.toService])).toEqual([['consumer:gateway#audit', 'channel:order.created', null]]);
  });

  it('tags: a frontend joining anything but the edge breaks it, and a consume joins the publishers', () => {
    const report = evaluateRules(shop(), [
      rule({ name: 'frontend-to-edge', tags: { source: 'frontend', mayReach: ['edge'] } }),
      rule({ name: 'edge-to-edge', severity: 'warning', tags: { source: 'edge', mayReach: ['edge'] } }),
      rule({ name: 'domain-anywhere', tags: { source: 'domain', mayReach: ['*'] } }),
    ]);
    expect(report.violations.map((item) => [item.rule, item.from, item.toService])).toEqual([
      ['frontend-to-edge', 'ui:web#direct', 'orders'],
      ['edge-to-edge', 'consumer:gateway#audit', 'orders'],
      ['edge-to-edge', 'http_out:gateway#orders', 'orders'],
    ]);
    expect(report.rules.map((item) => item.status)).toEqual(['broken', 'broken', 'held']);
  });

  it('reachable: a path that must exist passes while it does and fails when it does not', () => {
    const keeps = rule({ name: 'created-keeps-billing', reachable: { from: { channel: 'order.created' }, to: { service: 'billing' }, must: true } });
    expect(evaluateRules(shop(), [keeps]).violations).toEqual([]);
    const graph = shop();
    const quiet: RuleGraph = { ...graph, edges: graph.edges.filter((item) => item.to !== 'consumer:billing#created') };
    const report = evaluateRules(quiet, [keeps]);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toMatchObject({ from: 'channel:order.created', path: [], via: 'none' });
    expect(report.violations[0]?.message).toBe('nothing channel order.created selects reaches service billing any more');
  });

  it('selectors are ANDed, and a route is matched as METHOD /path', () => {
    const report = evaluateRules(shop(), [
      rule({ name: 'no-direct-get', forbid: { from: { service: 'web', type: 'ui_api_call' }, to: { route: 'GET /orders/*', service: 'orders' } } }),
      rule({ name: 'no-post', forbid: { from: { service: 'web' }, to: { route: 'POST /orders/*' } } }),
    ]);
    expect(report.violations.map((item) => item.rule)).toEqual(['no-direct-get']);
    expect(report.rules[1]?.status).toBe('unchecked');
  });

  it('a selector that names nothing is unchecked, never a pass, and says what was meant', () => {
    const report = evaluateRules(shop(), [rule({ name: 'typo', forbid: { from: { service: 'web' }, to: { service: 'biling' } } })]);
    expect(report.violations).toEqual([]);
    expect(report.unchecked).toEqual([
      expect.objectContaining({
        rule: 'typo',
        reason: 'rule-matches-nothing',
        side: 'to',
        selector: 'service biling',
        message: 'not checked (to): service "biling" names nothing in this graph; did you mean billing?',
        key: 'rule|typo|unchecked|to',
      }),
    ]);
    expect(report.summary).toMatchObject({ rules: 1, unchecked: 1, held: 0 });
    expect(ruleFailures(report, 'error').unchecked).toHaveLength(1);
  });

  it('a tag nobody carries is unchecked too', () => {
    const report = evaluateRules(shop(), [rule({ name: 'ghost', tags: { source: 'mobile', mayReach: ['edge'] } })]);
    expect(report.unchecked.map((item) => [item.side, item.selector])).toEqual([['source', 'tag mobile']]);
  });

  it('a guessed hop is shown at the rule\'s severity and fails only with failOnHeuristic', () => {
    const report = evaluateRules(shop(), [rule({ name: 'web-not-orders', forbid: { from: { service: 'web' }, to: { service: 'orders' } } })]);
    expect(report.violations[0]).toMatchObject({ severity: 'error', confidence: 'heuristic', heuristic: true });
    expect(ruleFailures(report, 'error').violations).toEqual([]);
    expect(ruleFailures(report, 'error', true).violations).toHaveLength(1);
    expect(ruleFailures(report, 'none', true).violations).toEqual([]);
  });

  it('a hop inside one service is read only when the rule asks for it', () => {
    const report = evaluateRules(shop(), [rule({ name: 'only-gateway-into-orders', only: { from: { service: 'gateway' }, to: { service: 'orders' } } })]);
    // orders reading its own table is not "something else reaching orders".
    expect(report.violations.map((item) => item.from)).toEqual(['ui:web#direct']);
    const calls = evaluateRules(shop(), [rule({ name: 'no-calls', forbid: { from: { service: 'billing' }, to: { type: 'method' }, via: ['calls'] } })]);
    expect(calls.violations.map((item) => item.to)).toEqual(['billing#InvoicesService.open']);
  });

  it('an accepted rule entry excuses what it covers and keeps it listed', () => {
    const report = evaluateRules(
      shop(),
      [rule({ name: 'only-orders-writes-orders', only: { from: { service: 'orders' }, to: { table: 'orders' }, op: 'write' } })],
      { accepted: [{ reason: 'rule:only-orders-writes-orders', service: 'billing', note: 'migration until June', acceptedAt: '2026-01-01T00:00:00.000Z' }] },
    );
    expect(report.violations).toEqual([]);
    expect(report.excused).toEqual([expect.objectContaining({ from: 'db_query:billing#mark', excusedBy: 'migration until June' })]);
    expect(report.rules[0]).toMatchObject({ status: 'held', excused: 1 });
  });

  it('a rule over a service read in part says so on every answer', () => {
    const report = evaluateRules({ ...shop(), partial: ['billing'] }, [
      rule({ name: 'only-orders-writes-orders', only: { from: { service: 'orders' }, to: { table: 'orders' }, op: 'write' } }),
      rule({ name: 'billing-out-of-orders', forbid: { from: { service: 'billing' }, to: { service: 'orders' } } }),
    ]);
    expect(report.notes).toEqual([expect.objectContaining({ rule: 'billing-out-of-orders', reason: 'rule-over-partial-read', service: 'billing' })]);
  });

  it('only, transitive: a write through a workflow the owner starts holds; a start of it by anyone else is where it breaks (P203)', () => {
    const owner = [rule({ name: 'only-billing-writes-payments', only: { from: { service: 'billing' }, to: { table: 'payments' }, op: 'write', reach: 'transitive' } })];
    const report = evaluateRules(payments(), owner);
    // The workflow's own write acts for billing, which starts it; orders starting it too is the violation, at the start.
    expect(report.violations.map((item) => [item.from, item.to, item.via, item.path.map((hop) => hop.type).join(' ')])).toEqual([
      ['start:orders#settle', 'table:settle#payments', 'triggers', 'triggers handles calls queries'],
      ['db_query:reports#fix', 'table:settle#payments', 'queries', 'queries'],
    ]);
    const [started, direct] = report.violations;
    expect(started?.at).toEqual({ service: 'orders', file: 'src/start-settle.ts', line: 10 });
    expect(started?.message).toBe('orders start settle reaches table payments (settle) in 4 hops, which only service billing may');
    expect(started?.confidence).toBe('heuristic');
    // A one-hop path is said as a direct `only` says it.
    expect(direct?.message).toBe('reports writes table payments (settle), which only service billing may');
    // The gateway in front of orders reaches the table too, but orders is the nearest and answers for the path.
    expect(report.violations.some((item) => item.fromService === 'gateway')).toBe(false);
    // Direct, the workflow's own write is the one blamed, and orders' start is not seen.
    const direct1 = evaluateRules(payments(), [rule({ name: 'only-billing-writes-payments', only: { from: { service: 'billing' }, to: { table: 'payments' }, op: 'write' } })]);
    expect(direct1.violations.map((item) => item.from)).toEqual(['db_query:reports#fix', 'db_query:settle#save']);
  });

  it('only, transitive: a read is not a write when op says write (P203)', () => {
    const report = evaluateRules(payments(), [rule({ name: 'only-billing-reads', only: { from: { service: 'billing' }, to: { table: 'payments' }, op: 'read', reach: 'transitive' } })]);
    expect(report.violations.map((item) => item.from)).toEqual(['db_query:reports#list']);
  });

  it('only, transitive: a handler of a channel the owner publishes onto acts for it, unless via leaves channels out (P203)', () => {
    const through = [rule({ name: 'only-orders-writes-orders', only: { from: { service: 'orders' }, to: { table: 'orders' }, op: 'write', reach: 'transitive' } })];
    expect(evaluateRules(shop(), through).violations).toEqual([]);
    const strict = evaluateRules(shop(), [
      rule({ name: 'only-orders-writes-orders', only: { from: { service: 'orders' }, to: { table: 'orders' }, op: 'write', via: ['http_calls', 'hits', 'queries', 'triggers'], reach: 'transitive' } }),
    ]);
    expect(strict.violations.map((item) => item.from)).toEqual(['db_query:billing#mark']);
  });

  it('only, transitive: a path through the owner is its own, and a request that goes round it is not (P203)', () => {
    const report = evaluateRules(shop(), [rule({ name: 'only-gateway-reaches-billing', only: { from: { service: 'gateway' }, to: { service: 'billing' }, reach: 'transitive' } })]);
    // The gateway asks orders, which publishes what billing consumes: that is the gateway's. The browser asking orders
    // straight goes round it, and its request is where the path starts.
    expect(report.violations.map((item) => [item.from, item.to, item.via, item.path.map((hop) => hop.type).join(' ')])).toEqual([
      ['ui:web#direct', 'consumer:billing#created', 'hits', 'hits handles calls emits consumes'],
    ]);
    expect(report.violations[0]?.at).toEqual({ service: 'web', file: 'src/GET-orders-param-direct.ts', line: 10 });
    // Direct, nothing hops into billing: a consume is billing's own hop onto the channel.
    expect(evaluateRules(shop(), [rule({ name: 'only-gateway-reaches-billing', only: { from: { service: 'gateway' }, to: { service: 'billing' } } })]).violations).toEqual([]);
  });

  it('only, transitive: when what the owner reaches is cut by the bound, nothing is said and the rule says it stopped (P203)', () => {
    const report = evaluateRules(payments(), [rule({ name: 'only-billing-writes-payments', only: { from: { service: 'billing' }, to: { table: 'payments' }, reach: 'transitive' } })], { maxWalk: 3 });
    expect(report.violations).toEqual([]);
    expect(report.rules[0]).toMatchObject({ walkCut: true, status: 'held' });
  });

  it('a transitive walk is bounded and says it stopped', () => {
    const report = evaluateRules(shop(), [rule({ name: 'web-never-billing', forbid: { from: { service: 'web' }, to: { service: 'billing' }, reach: 'transitive' } })], { maxWalk: 4 });
    expect(report.rules[0]).toMatchObject({ walkCut: true });
  });
});

describe('ruleSchema (P114)', () => {
  it('takes exactly one shape', () => {
    expect(ruleSchema.safeParse({ name: 'two', forbid: { from: { service: 'a' }, to: { service: 'b' } }, tags: { source: 'x', mayReach: ['y'] } }).success).toBe(false);
    expect(ruleSchema.safeParse({ name: 'none' }).success).toBe(false);
    expect(ruleSchema.safeParse({ name: 'Not Kebab', forbid: { from: { service: 'a' }, to: { service: 'b' } } }).success).toBe(false);
    expect(ruleSchema.safeParse({ name: 'ok', forbid: { from: {}, to: { service: 'b' } } }).success).toBe(false);
    expect(ruleSchema.parse({ name: 'ok', forbid: { from: { service: 'a' }, to: { service: 'b' } } }).severity).toBe('error');
  });

  it('takes reach on only as on forbid (P203)', () => {
    expect(ruleSchema.parse({ name: 'ok', only: { from: { service: 'a' }, to: { table: 'b' }, reach: 'transitive' } }).only?.reach).toBe('transitive');
    expect(ruleSchema.safeParse({ name: 'ok', only: { from: { service: 'a' }, to: { table: 'b' }, reach: 'sideways' } }).success).toBe(false);
  });
});
