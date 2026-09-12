import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SCHEMA_VERSION,
  type GraphEdge,
  type GraphNode,
  type ProjectGraph,
  type TypeRegistry,
  type Unresolved,
} from '@flowatlas/core';
import { openGraphDb, writeGraphDb, type GraphDb, type LinkReport } from '@flowatlas/linker';

const FIXED = '2026-01-01T00:00:00.000Z';

const node = (id: string, over: Partial<GraphNode> = {}): GraphNode => ({
  id,
  type: 'method',
  label: id,
  repo: 'gateway',
  ...over,
});

const edge = (from: string, to: string, over: Partial<GraphEdge> = {}): GraphEdge => ({
  from,
  to,
  type: 'calls',
  confidence: 'static',
  ...over,
});

const SERVICES = [
  { name: 'gateway', repo: './gateway', type: 'nestjs', extractor: null },
  { name: 'orders', repo: './orders', type: 'nestjs', extractor: null },
  { name: 'billing', repo: './billing', type: 'nestjs', extractor: null },
];

const NODES: GraphNode[] = [
  node('entry:gateway:http:POST:/orders', {
    type: 'entry',
    kind: 'http',
    label: 'POST /orders',
    file: 'src/orders/orders.controller.ts',
    line: 12,
    meta: { method: 'POST', path: '/orders' },
  }),
  node('entry:gateway:bot_callback:order_confirm', {
    type: 'entry',
    kind: 'bot_callback',
    label: 'order_confirm',
    file: 'src/bot/order.update.ts',
    line: 20,
    meta: { key: 'order_confirm' },
  }),
  node('entry:billing:event:order.created', {
    type: 'entry',
    kind: 'event',
    label: 'event order.created',
    repo: 'billing',
    file: 'src/invoices/invoices.consumer.ts',
    line: 9,
    meta: { pattern: 'order.created' },
  }),
  node('guard:gateway#AuthGuard', {
    type: 'guard',
    label: 'AuthGuard',
    file: 'src/auth/auth.guard.ts',
    line: 8,
  }),
  node('guard:gateway#RolesGuard', {
    type: 'guard',
    label: 'RolesGuard',
    file: 'src/auth/roles.guard.ts',
    line: 8,
  }),
  node('gateway#src/orders/orders.controller.ts:OrdersController.create', {
    label: 'OrdersController.create',
    file: 'src/orders/orders.controller.ts',
    line: 12,
  }),
  node('gateway#src/orders/orders.service.ts:OrdersService.create', {
    label: 'OrdersService.create',
    file: 'src/orders/orders.service.ts',
    line: 30,
  }),
  node('http_out:gateway#src/clients/orders.client.ts:20:4', {
    type: 'http_out',
    label: 'POST /orders',
    file: 'src/clients/orders.client.ts',
    line: 20,
    meta: { method: 'POST', path: '/orders', baseUrlEnv: 'ORDERS_URL' },
  }),
  node('entry:orders:http:POST:/orders', {
    type: 'entry',
    kind: 'http',
    label: 'POST /orders',
    repo: 'orders',
    file: 'src/orders/orders.controller.ts',
    line: 15,
    meta: { method: 'POST', path: '/orders' },
  }),
  node('orders#src/orders/orders.service.ts:OrdersService.create', {
    label: 'OrdersService.create',
    repo: 'orders',
    file: 'src/orders/orders.service.ts',
    line: 40,
  }),
  node('producer:orders#src/orders/orders.service.ts:44:2', {
    type: 'producer',
    label: 'event order.created',
    repo: 'orders',
    file: 'src/orders/orders.service.ts',
    line: 44,
  }),
  node('channel:order.created', { type: 'channel', label: 'order.created', repo: 'orders' }),
  node('channel:order.archived', { type: 'channel', label: 'order.archived', repo: 'orders' }),
  node('consumer:billing#src/invoices/invoices.consumer.ts:9', {
    type: 'consumer',
    label: 'InvoicesConsumer.onOrderCreated',
    repo: 'billing',
    file: 'src/invoices/invoices.consumer.ts',
    line: 9,
  }),
  node('billing#src/invoices/invoices.service.ts:InvoicesService.create', {
    label: 'InvoicesService.create',
    repo: 'billing',
    file: 'src/invoices/invoices.service.ts',
    line: 11,
  }),
  node('db_query:billing#src/invoices/invoices.service.ts:12:4', {
    type: 'db_query',
    label: 'write Invoice',
    repo: 'billing',
    file: 'src/invoices/invoices.service.ts',
    line: 12,
    meta: { op: 'write', table: 'Invoice' },
  }),
  node('table:billing#Invoice', { type: 'table', label: 'Invoice', repo: 'billing' }),
  // Two methods that call each other, so a walk has a cycle to end.
  node('gateway#src/loop.ts:Loop.a', { label: 'Loop.a', file: 'src/loop.ts', line: 3 }),
  node('gateway#src/loop.ts:Loop.b', { label: 'Loop.b', file: 'src/loop.ts', line: 9 }),
];

const EDGES: GraphEdge[] = [
  edge('entry:gateway:http:POST:/orders', 'guard:gateway#AuthGuard', {
    type: 'guarded_by',
    meta: { order: 0, kind: 'guard' },
  }),
  edge('entry:gateway:http:POST:/orders', 'guard:gateway#RolesGuard', {
    type: 'guarded_by',
    meta: { order: 1, kind: 'guard' },
  }),
  edge(
    'entry:gateway:http:POST:/orders',
    'gateway#src/orders/orders.controller.ts:OrdersController.create',
    { type: 'handles', params: ['type:@fx/contracts#CreateOrderDto'] },
  ),
  edge(
    'entry:gateway:bot_callback:order_confirm',
    'gateway#src/orders/orders.controller.ts:OrdersController.create',
    { type: 'handles' },
  ),
  edge(
    'gateway#src/orders/orders.controller.ts:OrdersController.create',
    'gateway#src/orders/orders.service.ts:OrdersService.create',
  ),
  edge(
    'gateway#src/orders/orders.service.ts:OrdersService.create',
    'http_out:gateway#src/clients/orders.client.ts:20:4',
  ),
  edge(
    'gateway#src/orders/orders.service.ts:OrdersService.create',
    'gateway#src/loop.ts:Loop.a',
    { confidence: 'heuristic' },
  ),
  edge('gateway#src/loop.ts:Loop.a', 'gateway#src/loop.ts:Loop.b'),
  edge('gateway#src/loop.ts:Loop.b', 'gateway#src/loop.ts:Loop.a'),
  edge('http_out:gateway#src/clients/orders.client.ts:20:4', 'entry:orders:http:POST:/orders', {
    type: 'http_calls',
    returns: 'type:@fx/contracts#OrderDto',
  }),
  edge('entry:orders:http:POST:/orders', 'orders#src/orders/orders.service.ts:OrdersService.create', {
    type: 'handles',
  }),
  edge(
    'orders#src/orders/orders.service.ts:OrdersService.create',
    'producer:orders#src/orders/orders.service.ts:44:2',
  ),
  edge('producer:orders#src/orders/orders.service.ts:44:2', 'channel:order.created', {
    type: 'emits',
    confidence: 'marker',
  }),
  edge('orders#src/orders/orders.service.ts:OrdersService.create', 'channel:order.archived', {
    type: 'emits',
  }),
  edge('channel:order.created', 'consumer:billing#src/invoices/invoices.consumer.ts:9', {
    type: 'consumes',
  }),
  edge(
    'consumer:billing#src/invoices/invoices.consumer.ts:9',
    'billing#src/invoices/invoices.service.ts:InvoicesService.create',
  ),
  edge(
    'billing#src/invoices/invoices.service.ts:InvoicesService.create',
    'db_query:billing#src/invoices/invoices.service.ts:12:4',
    { type: 'queries' },
  ),
  edge('db_query:billing#src/invoices/invoices.service.ts:12:4', 'table:billing#Invoice', {
    type: 'queries',
  }),
];

const TYPES: TypeRegistry = {
  'type:@fx/contracts#CreateOrderDto': {
    name: 'CreateOrderDto',
    kind: 'object',
    declaredIn: '@fx/contracts',
    structuralHash: 'aaaa1111',
    fields: [{ name: 'customerId', type: 'string', optional: false }],
    meta: { sharedPackage: '@fx/contracts' },
  },
  'type:@fx/contracts#OrderDto': {
    name: 'OrderDto',
    kind: 'object',
    declaredIn: '@fx/contracts',
    structuralHash: 'bbbb2222',
    fields: [
      { name: 'id', type: 'string', optional: false },
      { name: 'total', type: 'type:@fx/contracts#Money', optional: false },
    ],
    meta: { sharedPackage: '@fx/contracts' },
  },
  'type:@fx/contracts#Money': {
    name: 'Money',
    kind: 'object',
    declaredIn: '@fx/contracts',
    structuralHash: 'cccc3333',
    fields: [{ name: 'amount', type: 'number', optional: false }],
    meta: { sharedPackage: '@fx/contracts' },
  },
  // The same name declared two ways in two repositories: the drift case.
  'type:gateway#InvoiceDto': {
    name: 'InvoiceDto',
    kind: 'object',
    declaredIn: 'gateway#src/clients/invoice.dto.ts',
    structuralHash: 'dddd4444',
    fields: [{ name: 'id', type: 'string', optional: false }],
  },
  'type:billing#InvoiceDto': {
    name: 'InvoiceDto',
    kind: 'object',
    declaredIn: 'billing#src/invoices/invoice.dto.ts',
    structuralHash: 'eeee5555',
    fields: [
      { name: 'id', type: 'string', optional: false },
      { name: 'amount', type: 'number', optional: false },
    ],
  },
  // The same name in two repositories, but one declaration seen twice.
  'type:orders#OrderDto': {
    name: 'SharedOnly',
    kind: 'object',
    declaredIn: '@fx/contracts',
    structuralHash: 'ffff6666',
    meta: { sharedPackage: '@fx/contracts' },
  },
};

const UNRESOLVED: Unresolved[] = [
  {
    file: 'src/clients/payments.client.ts',
    line: 24,
    reason: 'unknown-base-url-env',
    message: 'PAYMENTS_URL is claimed by no service',
    service: 'gateway',
    symbol: 'http_out:gateway#src/clients/orders.client.ts:20:4',
  },
  {
    file: 'src/orders/orders.service.ts',
    line: 16,
    reason: 'di-token-unknown',
    message: 'OrdersService.constructor[1]',
    service: 'orders',
  },
  // One row standing for twelve places, which is how an inherent limit is
  // recorded. Here so the summary has to prove it still shows the total.
  {
    file: 'src/orders/orders.service.ts',
    line: 22,
    reason: 'call-dynamic-receiver',
    level: 'info',
    sites: 12,
    message: 'the receiver has no single class type',
    service: 'orders',
  },
];

const report = (): LinkReport => ({
  schemaVersion: SCHEMA_VERSION,
  builtAt: FIXED,
  configHash: 'test',
  services: [],
  ui: { total: 0, resolved: 0, unresolved: 0, byReason: {} },
  httpOut: {
    total: 2,
    linked: 1,
    byMarker: 0,
    unknownEnv: 1,
    noRoute: 0,
    ambiguous: 0,
    external: 0,
    dynamic: 0,
  },
  channels: { total: 2, linked: 1, noConsumers: ['channel:order.archived'], noProducers: [] },
  routes: { total: 2, called: 1, uncalled: ['entry:gateway:http:POST:/orders'], duplicated: [] },
  types: { total: Object.keys(TYPES).length, sharedPackage: 4 },
  unresolved: [],
  totals: {
    nodes: NODES.length,
    edges: EDGES.length,
    types: Object.keys(TYPES).length,
    unresolved: UNRESOLVED.length,
  },
});

const directory = mkdtempSync(join(tmpdir(), 'flowatlas-cli-'));

export interface TestProject {
  db: GraphDb;
  dbPath: string;
}

/**
 * A small project with everything a renderer has to survive.
 *
 * Three repositories, a guard chain, a bot callback answered by the same
 * handler as a route, a cross-repo call, a channel with a handler and one
 * without, a cycle, and two declarations of one name that disagree. Written and
 * read the way the tool does it, so a query that passes here is a real query.
 */
export const buildTestProject = (name = 'graph'): TestProject => {
  const dbPath = join(directory, `${name}.db`);
  const project: ProjectGraph = {
    schemaVersion: SCHEMA_VERSION,
    builtAt: FIXED,
    services: SERVICES,
    nodes: NODES,
    edges: EDGES,
    types: TYPES,
    unresolved: UNRESOLVED,
  };
  writeGraphDb(project, report(), dbPath);
  return { db: openGraphDb(dbPath), dbPath };
};

export const testProjectDirectory = directory;
