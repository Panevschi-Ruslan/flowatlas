import { rmSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { buildTestDb, edge, entry, node, testDbDirectory, type TestGraph } from '../test-graph.js';
import { projectDetail, truncate } from './detail.js';
import { isResolved, resolveEntryRef } from './entry-ref.js';
import { buildFlowTree, defaultFlowDepth, flatten, walkBack } from './flow.js';
import type { FlowNode } from './types.js';

afterAll(() => rmSync(testDbDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

/** One route, its guards, its handler, and what the handler reaches. */
const straightLine = (kind: string, key: string): TestGraph => ({
  nodes: [
    entry(`entry:orders:${kind}:${key}`, {
      kind,
      label: key,
      meta: kind === 'http' ? { method: 'GET', path: '/orders' } : { key },
    }),
    node('orders#guard.ts:AuthGuard', { type: 'guard', label: 'AuthGuard' }),
    node('orders#log.ts:LogInterceptor', { type: 'interceptor', label: 'LogInterceptor' }),
    node('orders#c.ts:Controller.handle', { label: 'Controller.handle', line: 10 }),
    node('orders#s.ts:Service.read', { label: 'Service.read', line: 20 }),
    node('db_query:orders#s.ts:21:3', { type: 'db_query', label: 'read Order' }),
    node('table:orders#Order', { type: 'table', label: 'Order', repo: 'orders' }),
  ],
  edges: [
    edge(`entry:orders:${kind}:${key}`, 'orders#log.ts:LogInterceptor', {
      type: 'guarded_by',
      meta: { order: 1, kind: 'interceptor' },
    }),
    edge(`entry:orders:${kind}:${key}`, 'orders#guard.ts:AuthGuard', {
      type: 'guarded_by',
      meta: { order: 0, kind: 'guard' },
    }),
    edge(`entry:orders:${kind}:${key}`, 'orders#c.ts:Controller.handle', { type: 'handles' }),
    edge('orders#c.ts:Controller.handle', 'orders#s.ts:Service.read', { line: 11 }),
    edge('orders#s.ts:Service.read', 'db_query:orders#s.ts:21:3', { line: 21 }),
    edge('db_query:orders#s.ts:21:3', 'table:orders#Order', { type: 'queries' }),
  ],
});

/** The same shape without the ids, so two walks can be compared. */
const shapeOf = (flow: FlowNode): unknown => ({
  type: flow.node.type,
  edge: flow.edge?.type ?? null,
  guards: (flow.guards ?? []).map((guard) => guard.kind),
  children: flow.children.map(shapeOf),
});

describe('walking outward from an entry', () => {
  it('follows the whole chain into the data layer', () => {
    const db = buildTestDb(straightLine('http', 'GET /orders'));
    const { root } = buildFlowTree(db, 'entry:orders:http:GET /orders', { depth: 8 });

    expect(flatten(root).map((item) => item.node.id)).toEqual([
      'entry:orders:http:GET /orders',
      'orders#c.ts:Controller.handle',
      'orders#s.ts:Service.read',
      'db_query:orders#s.ts:21:3',
      'table:orders#Order',
    ]);
    db.close();
  });

  it('puts what runs before the handler on the entry, in the order it runs', () => {
    const db = buildTestDb(straightLine('http', 'GET /orders'));
    const { root } = buildFlowTree(db, 'entry:orders:http:GET /orders', {});

    expect(root.guards?.map((guard) => [guard.order, guard.kind, guard.label])).toEqual([
      [0, 'guard', 'AuthGuard'],
      [1, 'interceptor', 'LogInterceptor'],
    ]);
    // A guard is named on the entry, never walked into as if it were the flow.
    expect(root.children.map((child) => child.node.type)).toEqual(['method']);
    db.close();
  });

  it('walks a bot callback exactly as it walks a route', () => {
    const asRoute = buildTestDb(straightLine('http', 'GET /orders'));
    const asCallback = buildTestDb(straightLine('bot_callback', 'order_confirm'));

    const left = buildFlowTree(asRoute, 'entry:orders:http:GET /orders', { depth: 8 });
    const right = buildFlowTree(asCallback, 'entry:orders:bot_callback:order_confirm', { depth: 8 });

    expect(shapeOf(right.root)).toEqual(shapeOf(left.root));
    asRoute.close();
    asCallback.close();
  });

  it('ends a branch at a node already on it rather than going round', () => {
    const db = buildTestDb({
      nodes: [entry('entry:orders:http:GET /a'), node('orders#A.go'), node('orders#B.go')],
      edges: [
        edge('entry:orders:http:GET /a', 'orders#A.go', { type: 'handles' }),
        edge('orders#A.go', 'orders#B.go'),
        edge('orders#B.go', 'orders#A.go'),
      ],
    });
    const { root } = buildFlowTree(db, 'entry:orders:http:GET /a', { depth: 10 });
    const repeated = flatten(root).filter((item) => item.node.id === 'orders#A.go');

    expect(repeated).toHaveLength(2);
    expect(repeated[1]?.node.ref).toBe(true);
    expect(repeated[1]?.children).toEqual([]);
    db.close();
  });

  it('stops at the depth it was given', () => {
    const db = buildTestDb(straightLine('http', 'GET /orders'));
    const { root } = buildFlowTree(db, 'entry:orders:http:GET /orders', { depth: 2 });
    expect(flatten(root)).toHaveLength(3);
    db.close();
  });

  it('says exactly how many nodes it left out', () => {
    const db = buildTestDb(straightLine('http', 'GET /orders'));
    const flow = buildFlowTree(db, 'entry:orders:http:GET /orders', { depth: 8, maxNodes: 3 });

    expect(flatten(flow.root)).toHaveLength(3);
    expect(flow.truncated).toBe('2 more nodes, increase depth or narrow scope');
    db.close();
  });

  it('gives every edge a confidence, whatever the detail', () => {
    const db = buildTestDb(straightLine('http', 'GET /orders'));
    for (const detail of [0, 1, 2] as const) {
      const { root } = buildFlowTree(db, 'entry:orders:http:GET /orders', { depth: 8, detail });
      for (const item of flatten(root).slice(1)) {
        expect(item.edge?.confidence).toBeTruthy();
      }
    }
    db.close();
  });

  it('shows a node the graph promised but does not hold, and counts it', () => {
    const db = buildTestDb({
      nodes: [entry('entry:orders:http:GET /a'), node('orders#A.go')],
      edges: [
        edge('entry:orders:http:GET /a', 'orders#A.go', { type: 'handles' }),
        edge('orders#A.go', 'orders#gone'),
      ],
    });
    const flow = buildFlowTree(db, 'entry:orders:http:GET /a', {});
    const leaf = flatten(flow.root).find((item) => item.node.id === 'orders#gone');

    expect(leaf?.node.type).toBe('missing');
    expect(flow.unresolvedOnPath).toBe(1);
    db.close();
  });

  it('counts a node the build recorded a problem against', () => {
    const db = buildTestDb({
      nodes: [entry('entry:orders:http:GET /a'), node('http_out:orders#a.ts:1:1', { type: 'http_out' })],
      edges: [edge('entry:orders:http:GET /a', 'http_out:orders#a.ts:1:1', { type: 'calls' })],
      unresolved: [
        {
          service: 'orders',
          file: 'a.ts',
          line: 1,
          reason: 'target-route-not-found',
          message: 'target service billing has no route POST /x',
          symbol: 'http_out:orders#a.ts:1:1',
        },
      ],
    });
    expect(buildFlowTree(db, 'entry:orders:http:GET /a', {}).unresolvedOnPath).toBe(1);
    db.close();
  });

  /** A route that sends to a queue whose consumer is a function with no body to read (R168). */
  const toUnreadConsumer: TestGraph = {
    nodes: [
      entry('entry:desk:http:POST:/loans'),
      node('desk#loans.ts:createLoan'),
      node('channel:sqs/loans-opened', { type: 'channel' }),
      node('consumer:desk#queues.tf:archive', { type: 'consumer' }),
      entry('entry:desk:invoke:archive-loan', { kind: 'invoke' }),
    ],
    edges: [
      edge('entry:desk:http:POST:/loans', 'desk#loans.ts:createLoan', { type: 'handles' }),
      edge('desk#loans.ts:createLoan', 'channel:sqs/loans-opened', { type: 'emits' }),
      edge('channel:sqs/loans-opened', 'consumer:desk#queues.tf:archive', { type: 'consumes' }),
      edge('consumer:desk#queues.tf:archive', 'entry:desk:invoke:archive-loan'),
    ],
    unresolved: [
      {
        service: 'desk',
        file: 'functions.tf',
        line: 70,
        reason: 'function-handler-unread',
        level: 'info',
        message: 'archive-loan runs consumers.archiveLoan, which names no function of this repository',
        symbol: 'entry:desk:invoke:archive-loan',
      },
    ],
  };

  it('counts the entry a path ends at, whose handler could not be read', () => {
    const db = buildTestDb(toUnreadConsumer);
    expect(buildFlowTree(db, 'entry:desk:http:POST:/loans', {}).unresolvedOnPath).toBe(1);
    db.close();
  });

  it('counts a node the walk reaches past the budget it shows', () => {
    const db = buildTestDb(toUnreadConsumer);
    const flow = buildFlowTree(db, 'entry:desk:http:POST:/loans', { maxNodes: 2 });
    expect(flatten(flow.root).map((item) => item.node.id)).not.toContain('entry:desk:invoke:archive-loan');
    expect(flow.unresolvedOnPath).toBe(1);
    db.close();
  });
});

describe('walking a workflow', () => {
  const STEPS = 12;
  const step = (index: number): string => `loans#flow.asl.json:approval/Step${index}`;

  /**
   * A chain of steps longer than the usual depth, the first of which invokes a
   * function and catches into the last; the catch is written above the next
   * step, on an earlier line.
   */
  const workflow = (): TestGraph => ({
    nodes: [
      entry('entry:loans:workflow:approval', { kind: 'workflow', label: 'approval', meta: { states: STEPS } }),
      ...Array.from({ length: STEPS }, (_, index) => node(step(index), { kind: 'state', label: `Step${index}`, line: 10 * (index + 1) })),
      entry('entry:loans:invoke:check', { kind: 'invoke', label: 'check' }),
      node('loans#check.ts:handler', { label: 'handler' }),
    ],
    edges: [
      edge('entry:loans:workflow:approval', step(0), { type: 'handles' }),
      edge(step(0), 'entry:loans:invoke:check', { line: 10, meta: { via: 'deployed-name' } }),
      edge(step(0), step(STEPS - 1), { line: 12, meta: { order: 1, transitions: [{ kind: 'catch' }] } }),
      edge(step(0), step(1), { line: 15, meta: { order: 0, transitions: [{ kind: 'next' }] } }),
      ...Array.from({ length: STEPS - 2 }, (_, index) =>
        edge(step(index + 1), step(index + 2), { line: 10 * (index + 2), meta: { order: 0 } }),
      ),
      edge('entry:loans:invoke:check', 'loans#check.ts:handler', { type: 'handles' }),
    ],
  });

  it('takes what a step does first, then where control goes, in the order it goes there', () => {
    const db = buildTestDb(workflow());
    const { root } = buildFlowTree(db, 'entry:loans:workflow:approval', {});
    const first = root.children[0] as FlowNode;
    expect(first.children.map((child) => child.node.id)).toEqual([
      'entry:loans:invoke:check',
      step(1),
      step(STEPS - 1),
    ]);
    db.close();
  });

  it('goes, without being told how far, through every step and on into what the last one reaches', () => {
    const db = buildTestDb(workflow());
    const ids = flatten(buildFlowTree(db, 'entry:loans:workflow:approval', {}).root).map((item) => item.node.id);
    // The step before the last is reached only along the chain, eleven hops in.
    expect(ids).toContain(step(STEPS - 2));
    expect(ids).toContain('loans#check.ts:handler');
    // Told, it stops where it was told.
    const short = flatten(buildFlowTree(db, 'entry:loans:workflow:approval', { depth: 8 }).root).map((item) => item.node.id);
    expect(short).not.toContain(step(9));
    db.close();
  });

  it('goes the usual eight hops from an entry that is not a chain of steps', () => {
    expect(defaultFlowDepth(undefined)).toBe(8);
    expect(defaultFlowDepth({ id: 'entry:a:http:GET /', type: 'entry', label: 'GET /', repo: 'a' })).toBe(8);
    expect(defaultFlowDepth({ id: 'entry:a:workflow:w', type: 'entry', kind: 'workflow', label: 'w', repo: 'a', meta: { states: 12 } })).toBe(20);
  });

  it('walks back further by every step it climbs, until it climbs no new one', () => {
    // A chain of twelve steps above a handler, the step that reaches the handler
    // last, and a route above the chain: twelve hops of climbing and four more.
    const steps = Array.from({ length: 12 }, (_, index) => ({ id: `step${index}`, meta: { workflow: 'approval' } }));
    const path = [{ id: 'handler' }, { id: 'invoke' }, ...[...steps].reverse(), { id: 'workflow', meta: { states: 12 } }, { id: 'route' }];
    const asked: number[] = [];
    const walk = (depth: number) => {
      asked.push(depth);
      // A second path to one step reaches it again, and it is still one step.
      return { rows: [...path.slice(0, depth + 1), ...(depth >= 3 ? path.slice(2, 3) : [])] };
    };
    expect(walkBack(8, walk).rows.map((row) => row.id)).toContain('route');
    expect(asked).toEqual([8, 15, 20]);
    // A walk that climbs nothing goes the usual distance once.
    expect(walkBack(8, () => ({ rows: [{ id: 'handler' }] })).rows).toHaveLength(1);
  });
});

describe('naming an entry the way a person would', () => {
  const db = buildTestDb({
    nodes: [
      entry('entry:orders:http:GET:/orders/:param', {
        label: 'GET /orders/:param',
        meta: { method: 'GET', path: '/orders/:param' },
      }),
      entry('entry:gateway:http:GET:/orders/:param', {
        repo: 'gateway',
        label: 'GET /orders/:param',
        meta: { method: 'GET', path: '/orders/:param' },
      }),
      entry('entry:orders:bot_callback:order_confirm', {
        kind: 'bot_callback',
        label: 'order_confirm',
        meta: { key: 'order_confirm' },
      }),
      entry('entry:orders:http:POST:/orders', {
        label: 'POST /orders',
        meta: { method: 'POST', path: '/orders' },
      }),
      entry('entry:orders:http:GET:/tickets/:param', {
        label: 'GET /tickets/:param',
        meta: { method: 'GET', path: '/tickets/:param' },
      }),
    ],
    edges: [],
  });

  it('accepts a route with a real value where the hole is', () => {
    const found = resolveEntryRef(db, 'POST /orders');
    expect(isResolved(found) && found.id).toBe('entry:orders:http:POST:/orders');
  });

  it('normalises the value into the hole', () => {
    const found = resolveEntryRef(db, 'get /tickets/12345');
    expect(isResolved(found) && found.id).toBe('entry:orders:http:GET:/tickets/:param');
  });

  it('accepts a bot key', () => {
    const found = resolveEntryRef(db, 'bot:order_confirm');
    expect(isResolved(found) && found.id).toBe('entry:orders:bot_callback:order_confirm');
  });

  it('accepts the full id unchanged', () => {
    const found = resolveEntryRef(db, 'entry:orders:http:POST:/orders');
    expect(isResolved(found) && found.id).toBe('entry:orders:http:POST:/orders');
  });

  it('refuses to choose when two services serve the same route', () => {
    const found = resolveEntryRef(db, 'GET /orders/9');
    expect(isResolved(found)).toBe(false);
    expect(!isResolved(found) && found.candidates.map((item) => item.repo)).toEqual([
      'gateway',
      'orders',
    ]);
  });

  it('comes back empty rather than guessing', () => {
    const found = resolveEntryRef(db, 'PUT /nowhere');
    expect(!isResolved(found) && found.candidates).toEqual([]);
  });
});

describe('saying only as much as was asked for', () => {
  const sample = node('orders#s.ts:Service.read', {
    label: 'Service.read',
    file: 'src/s.ts',
    line: 20,
    kind: 'injectable',
    meta: { module: 'AppModule' },
  });

  it('gives an identity at level 0', () => {
    expect(projectDetail(sample, 0)).toEqual({
      id: 'orders#s.ts:Service.read',
      type: 'method',
      label: 'Service.read',
    });
  });

  it('adds where to find it at level 1', () => {
    expect(projectDetail(sample, 1)).toEqual({
      id: 'orders#s.ts:Service.read',
      type: 'method',
      label: 'Service.read',
      loc: 'src/s.ts:20',
      service: 'orders',
      kind: 'injectable',
    });
  });

  it('adds what it knows about itself at level 2', () => {
    expect(projectDetail(sample, 2).meta).toEqual({ module: 'AppModule' });
  });

  it('counts exactly what it left out', () => {
    const { items, truncated } = truncate([1, 2, 3, 4, 5], 2);
    expect(items).toEqual([1, 2]);
    expect(truncated).toBe('3 more nodes, increase depth or narrow scope');
  });

  it('says nothing about truncation when nothing was cut', () => {
    expect(truncate([1, 2], 5).truncated).toBeUndefined();
  });
});
