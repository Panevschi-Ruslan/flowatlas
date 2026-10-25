/**
 * A small bookshop, built by hand, for the document writers and the spec diff
 * (P118): exactly the routes, channels and shapes the tests ask about, so a
 * failure names the rule and not a fixture.
 */
import { SCHEMA_VERSION, type Failure, type GraphEdge, type GraphNode, type ProjectGraph, type TypeEntry, type TypeField } from '@flowatlas/core';

const FIXED = '2026-01-01T00:00:00.000Z';

const field = (name: string, type: string, optional = false, meta?: Record<string, unknown>): TypeField => ({
  name,
  type,
  optional,
  ...(meta === undefined ? {} : { meta }),
});

const object = (repo: string, name: string, fields: TypeField[], extra: Partial<TypeEntry> = {}): TypeEntry => ({
  name,
  kind: 'object',
  declaredIn: `${repo}#src/${name}.ts`,
  structuralHash: name,
  fields,
  ...extra,
});

const entry = (service: string, method: string, path: string, rawPath: string, over: Partial<GraphNode> = {}, application?: string): GraphNode => ({
  id: `entry:${service}${application === undefined ? '' : `@${application}`}:http:${method}:${path}`,
  type: 'entry',
  kind: 'http',
  label: `${method} ${path}`,
  repo: service,
  file: 'src/orders.controller.ts',
  line: 10,
  ...over,
  meta: { method, path, rawPath, ...(over.meta ?? {}) },
});

const handler = (service: string, name: string): GraphNode => ({
  id: `${service}#src/orders.controller.ts:${name}`,
  type: 'method',
  label: name,
  repo: service,
  file: 'src/orders.controller.ts',
});

const handles = (from: string, to: string, over: Partial<GraphEdge> = {}): GraphEdge => ({
  from,
  to,
  type: 'handles',
  confidence: 'static',
  file: 'src/orders.controller.ts',
  line: 12,
  ...over,
});

const fail = (status: number | undefined, exception: string, over: Partial<Failure> = {}): Failure => ({
  ...(status === undefined ? {} : { status }),
  exception,
  at: 'orders#src/orders.service.ts:OrdersService.create',
  file: 'src/orders.service.ts',
  line: 20,
  source: 'throw',
  ...over,
});

/** What the tests change between a base and a head. */
export interface SpecGraphOptions {
  /** `CreateOrder` gains a required `channel` the gateway does not send. */
  requiredChannel?: boolean;
  /** `GET /orders/:id` is gone. */
  dropFindOne?: boolean;
  /** Nobody calls `POST /orders`. */
  uncalled?: boolean;
  /** `Order.total` is text rather than a number. */
  totalAsText?: boolean;
  /** `OrderCreated.placedAt` is gone from what orders publishes. */
  dropPlacedAt?: boolean;
  /** billing no longer handles `order.created`. */
  dropConsumer?: boolean;
  /** `POST /orders` can now fail with 409. */
  conflict?: boolean;
  /** A second guard stands in front of `POST /orders`. */
  secondGuard?: boolean;
  /** `GET /health` takes a required query value. */
  healthQuery?: boolean;
}

export const specGraph = (options: SpecGraphOptions = {}): ProjectGraph => {
  const create = entry('orders', 'POST', '/orders', '/orders', {
    meta: {
      fails: [
        fail(400, 'BadRequestException', { source: 'pipe' }),
        fail(500, 'Error', { assumed: true }),
        ...(options.conflict === true ? [fail(409, 'ConflictException')] : []),
      ],
      access: {
        guards: [
          { id: 'orders#src/auth.guard.ts:AuthGuard', name: 'AuthGuard', layer: 'guard', where: 'global', via: 'APP_GUARD in AuthModule' },
          ...(options.secondGuard === true
            ? [{ id: 'orders#src/roles.guard.ts:RolesGuard', name: 'RolesGuard', layer: 'guard', where: 'route', via: '@UseGuards on OrdersController.create' }]
            : []),
        ],
      },
    },
  });
  const findOne = entry('orders', 'GET', '/orders/:param', '/orders/:id', {
    line: 20,
    meta: { fails: [fail(undefined, 'toHttpError', { via: 'helper', chosenFrom: [{ exception: 'UnauthorizedException', status: 401 }, { exception: 'ForbiddenException', status: 403 }] }), fail(undefined, 'Error')] },
  });
  const health = entry('orders', 'GET', '/health', '/health', { line: 30, meta: { publicNote: 'load balancer probes' } });
  const files = entry('orders', 'ALL', '/files/*', '/files/*', { line: 40 });
  const unread = entry('orders', 'GET', '/reports/${…}', '/reports/${…}', { line: 50 });
  const stats = entry('orders', 'GET', '/stats', '/stats', { line: 60 }, 'admin');
  const page = entry('orders', 'GET', '/orders', '/orders', { line: 70 });

  const nodes: GraphNode[] = [
    create,
    handler('orders', 'OrdersController.create'),
    ...(options.dropFindOne === true ? [] : [findOne, handler('orders', 'OrdersController.findOne')]),
    health,
    handler('orders', 'HealthController.check'),
    files,
    unread,
    stats,
    handler('orders', 'StatsController.stats'),
    page,
    handler('orders', 'OrdersController.page'),
    { id: 'http_out:gateway#src/orders.client.ts:21:5', type: 'http_out', label: 'POST /orders', repo: 'gateway', file: 'src/orders.client.ts', line: 21 },
    { id: 'http_out:gateway#src/orders.client.ts:30:5', type: 'http_out', label: 'GET /orders/:param', repo: 'gateway', file: 'src/orders.client.ts', line: 30 },
    // orders publishes order.created; billing handles it, and a queue delivers it wrapped.
    { id: 'orders#src/orders.service.ts:OrdersService.create', type: 'method', label: 'OrdersService.create', repo: 'orders', file: 'src/orders.service.ts' },
    { id: 'producer:orders#src/orders.service.ts:22:5', type: 'producer', kind: 'event', label: 'emit order.created', repo: 'orders', file: 'src/orders.service.ts', line: 22 },
    { id: 'channel:order.created', type: 'channel', label: 'order.created', repo: 'orders', meta: { channelKind: 'topic' } },
    ...(options.dropConsumer === true
      ? []
      : [
          { id: 'entry:billing:event:order.created', type: 'entry' as const, kind: 'event', label: 'event order.created', repo: 'billing', file: 'src/invoices.consumer.ts', line: 8 },
          { id: 'billing#src/invoices.consumer.ts:InvoicesConsumer.onOrderCreated', type: 'method' as const, label: 'InvoicesConsumer.onOrderCreated', repo: 'billing', file: 'src/invoices.consumer.ts' },
          {
            id: 'consumer:billing#src/invoices.consumer.ts:8:3',
            type: 'consumer' as const,
            kind: 'event',
            label: 'InvoicesConsumer.onOrderCreated',
            repo: 'billing',
            file: 'src/invoices.consumer.ts',
            line: 8,
            meta: { entryId: 'entry:billing:event:order.created' },
          },
        ]),
    { id: 'channel:sqs/receipts', type: 'channel', label: 'sqs/receipts', repo: 'billing', meta: { channelKind: 'queue' } },
    { id: 'producer:billing#src/receipts.ts:9:3', type: 'producer', kind: 'message', label: 'send sqs/receipts', repo: 'billing', file: 'src/receipts.ts', line: 9 },
    {
      id: 'consumer:mailer#infra/main.tf:aws_lambda_event_source_mapping.receipts',
      type: 'consumer',
      kind: 'message',
      label: 'mapping receipts',
      repo: 'mailer',
      file: 'infra/main.tf',
      line: 4,
      meta: { deployedBy: 'terraform', envelope: { at: ['Records', '[]', 'body'], text: true } },
    },
    {
      id: 'entry:mailer:invoke:send-receipt',
      type: 'entry',
      kind: 'invoke',
      label: 'invoke send-receipt',
      repo: 'mailer',
      file: 'src/send-receipt.ts',
      line: 3,
      meta: { reads: { '': 'type:aws#SQSEvent', 'Records[].body': 'type:mailer#Receipt' } },
    },
  ];

  const edges: GraphEdge[] = [
    handles(create.id, 'orders#src/orders.controller.ts:OrdersController.create', {
      params: ['type:orders#CreateOrder'],
      returns: 'type:orders#Order',
      meta: { body: 'type:orders#CreateOrder' },
    }),
    ...(options.dropFindOne === true
      ? []
      : [
          handles(findOne.id, 'orders#src/orders.controller.ts:OrdersController.findOne', {
            line: 22,
            params: ['string', 'type:orders#ListQuery'],
            returns: 'type:orders#Order | null',
            meta: { params: '{id:string}', query: 'type:orders#ListQuery', headers: '{x-shop:string}' },
          }),
          { from: 'http_out:gateway#src/orders.client.ts:30:5', to: findOne.id, type: 'http_calls' as const, confidence: 'static' as const, file: 'src/orders.client.ts', line: 30 },
        ]),
    handles(health.id, 'orders#src/orders.controller.ts:HealthController.check', {
      returns: 'void',
      meta: options.healthQuery === true ? { query: '{verbose:boolean}' } : {},
    }),
    handles(stats.id, 'orders#src/orders.controller.ts:StatsController.stats', { returns: 'type:orders#Stats' }),
    handles(page.id, 'orders#src/orders.controller.ts:OrdersController.page', { returns: 'type:orders#Paginated<type:orders#Order>' }),
    ...(options.uncalled === true
      ? []
      : [{ from: 'http_out:gateway#src/orders.client.ts:21:5', to: create.id, type: 'http_calls' as const, confidence: 'static' as const, file: 'src/orders.client.ts', line: 21 }]),
    { from: 'orders#src/orders.service.ts:OrdersService.create', to: 'producer:orders#src/orders.service.ts:22:5', type: 'calls', confidence: 'static' },
    { from: 'producer:orders#src/orders.service.ts:22:5', to: 'channel:order.created', type: 'emits', confidence: 'static', params: ['type:orders#OrderCreated'], file: 'src/orders.service.ts', line: 22 },
    ...(options.dropConsumer === true
      ? []
      : [
          { from: 'channel:order.created', to: 'consumer:billing#src/invoices.consumer.ts:8:3', type: 'consumes' as const, confidence: 'static' as const },
          { from: 'consumer:billing#src/invoices.consumer.ts:8:3', to: 'billing#src/invoices.consumer.ts:InvoicesConsumer.onOrderCreated', type: 'handles' as const, confidence: 'static' as const },
          handles('entry:billing:event:order.created', 'billing#src/invoices.consumer.ts:InvoicesConsumer.onOrderCreated', {
            params: ['type:billing#OrderCreated'],
            meta: { body: 'type:billing#OrderCreated' },
          }),
        ]),
    { from: 'producer:billing#src/receipts.ts:9:3', to: 'channel:sqs/receipts', type: 'emits', confidence: 'static', params: ['type:billing#Receipt'] },
    { from: 'channel:sqs/receipts', to: 'consumer:mailer#infra/main.tf:aws_lambda_event_source_mapping.receipts', type: 'consumes', confidence: 'static' },
    { from: 'consumer:mailer#infra/main.tf:aws_lambda_event_source_mapping.receipts', to: 'entry:mailer:invoke:send-receipt', type: 'calls', confidence: 'static' },
  ];

  const types: Record<string, TypeEntry> = {
    'type:orders#CreateOrder': object('orders', 'CreateOrder', [
      field('customerId', 'string'),
      ...(options.requiredChannel === true ? [field('channel', 'string')] : []),
      field('placedAt', 'Date'),
      field('note', 'string | undefined'),
      field('secret', 'string', false, { exclude: true }),
      field('couponCode', 'string', false, { exposeAs: 'coupon_code' }),
      field('discount', 'number', false, { transform: true }),
      field('extras', 'any'),
      field('lines', 'type:orders#OrderLine[]'),
      field('status', 'type:orders#Status'),
      field('tags', 'Set<string>'),
      field('gift', 'string', true, { optionalBy: 'IsOptional', validators: ['IsOptional'] }),
    ]),
    'type:orders#OrderLine': object('orders', 'OrderLine', [field('sku', 'string'), field('quantity', 'number')]),
    'type:orders#Status': { name: 'Status', kind: 'enum', declaredIn: 'orders#src/status.ts', structuralHash: 's', members: ['open', 'closed'] },
    'type:orders#Order': object('orders', 'Order', [
      field('id', 'string'),
      field('total', options.totalAsText === true ? 'string' : 'number'),
      field('category', 'type:orders#Category', true),
      field('shipping', 'type:shipping#Label'),
    ]),
    'type:orders#Category': object('orders', 'Category', [field('id', 'string'), field('children', 'type:orders#Category[]')]),
    'type:orders#ListQuery': object('orders', 'ListQuery', [field('q', 'string'), field('page', 'number', true)]),
    'type:orders#Stats': object('orders', 'Stats', [field('open', 'number')]),
    'type:orders#Paginated': object('orders', 'Paginated', [field('items', 'T[]'), field('total', 'number')], { kind: 'generic', typeParams: ['T'] }),
    'type:shipping#Label': { name: 'Label', kind: 'external', declaredIn: 'shipping', structuralHash: 'l' },
    'type:orders#OrderCreated': object('orders', 'OrderCreated', [
      field('orderId', 'string'),
      ...(options.dropPlacedAt === true ? [] : [field('placedAt', 'Date')]),
    ]),
    'type:billing#OrderCreated': object('billing', 'OrderCreated', [field('orderId', 'string')]),
    'type:billing#Receipt': object('billing', 'Receipt', [field('orderId', 'string'), field('amount', 'number')]),
    'type:mailer#Receipt': object('mailer', 'Receipt', [field('orderId', 'string')]),
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    builtAt: FIXED,
    services: [
      { name: 'orders', repo: './orders', type: 'nestjs', extractor: null },
      { name: 'gateway', repo: './gateway', type: 'nestjs', extractor: null },
      { name: 'billing', repo: './billing', type: 'nestjs', extractor: null },
      { name: 'mailer', repo: './mailer', type: 'lambda', extractor: null },
    ],
    nodes,
    edges,
    types,
    unresolved: [],
  };
};
