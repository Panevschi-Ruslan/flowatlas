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

  it('says where each check was put and what the handler opted out of, where the reader said (P76)', () => {
    const graph = straightLine('http', 'GET /orders');
    const [first, ...rest] = graph.nodes;
    const access = {
      guards: [
        { id: 'orders#guard.ts:AuthGuard', name: 'AuthGuard', layer: 'guard', where: 'global', via: 'APP_GUARD in AuthModule', skippedBy: 'Public' },
      ],
      optOuts: [{ decorator: 'Public', key: 'isPublic', public: true, skips: ['AuthGuard'], where: 'route', file: 'src/c.ts', line: 9 }],
    };
    const db = buildTestDb({ ...graph, nodes: [{ ...first!, meta: { ...first!.meta, access } }, ...rest] });
    const { root } = buildFlowTree(db, 'entry:orders:http:GET /orders', {});
    expect(root.guards?.[0]).toMatchObject({ label: 'AuthGuard', where: 'global', via: 'APP_GUARD in AuthModule', skippedBy: 'Public' });
    expect(root.guards?.[1]).not.toHaveProperty('where');
    expect(root.optOuts).toEqual([
      { decorator: 'Public', key: 'isPublic', public: true, skips: ['AuthGuard'], where: 'route', loc: 'src/c.ts:9' },
    ]);
    db.close();
  });

  it('groups what the way in fails with by status and exception, and lists the places at detail 2 (P87)', () => {
    const graph = straightLine('http', 'GET /orders');
    const [first, ...rest] = graph.nodes;
    const fails = [
      { status: 404, exception: 'OrderMissing', at: 'orders#s.ts:Service.read', file: 's.ts', line: 22, source: 'throw' },
      { status: 404, exception: 'OrderMissing', at: 'orders#s.ts:Service.read', file: 's.ts', line: 25, source: 'throw' },
      { status: 500, exception: 'Error', at: 'orders#c.ts:Controller.handle', file: 'c.ts', line: 12, source: 'throw', assumed: true },
    ];
    const db = buildTestDb({ ...graph, nodes: [{ ...first!, meta: { ...first!.meta, fails } }, ...rest] });
    const brief = buildFlowTree(db, 'entry:orders:http:GET /orders', {}).root;
    expect(brief.fails).toEqual([
      { status: 404, exception: 'OrderMissing', sources: ['throw'], sites: 2, at: 'orders#s.ts:Service.read', loc: 's.ts:22' },
      { status: 500, exception: 'Error', assumed: true, sources: ['throw'], sites: 1, at: 'orders#c.ts:Controller.handle', loc: 'c.ts:12' },
    ]);
    const full = buildFlowTree(db, 'entry:orders:http:GET /orders', { detail: 2 }).root;
    expect(full.fails?.[0]?.places).toEqual([
      { at: 'orders#s.ts:Service.read', loc: 's.ts:22', source: 'throw' },
      { at: 'orders#s.ts:Service.read', loc: 's.ts:25', source: 'throw' },
    ]);
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
    // A cycle is read off its own path, so it says nowhere else to look.
    expect(repeated[1]?.node).not.toHaveProperty('seenAt');
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
    expect(flow.truncated).toBe('2 more nodes past maxNodes 3; raise maxNodes or ask get_flow on a child id');
    expect(flow.stoppedBy).toEqual(['maxNodes']);
    expect(flow.left).toBe(2);
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

describe('spending the budget where the answer is (P92)', () => {
  const route = 'entry:shop:http:POST:/orders';
  const helper = 'shop#repo.ts:OrderRepository.findOne';
  const logger = 'shop#log.ts:Logger.log';

  /**
   * A route whose service has three methods that each read through one
   * repository helper and log through one logger, and an outgoing request four
   * hops down, behind all of it. The logger has a body of its own.
   */
  const plumbing = (): TestGraph => {
    const methods = ['a', 'b', 'c'].map((name) => `shop#s.ts:Service.${name}`);
    return {
      nodes: [
        entry(route, { repo: 'shop' }),
        node('shop#c.ts:Controller.create', { repo: 'shop' }),
        ...methods.map((id) => node(id, { repo: 'shop' })),
        node('shop#s.ts:Service.notify', { repo: 'shop' }),
        node(helper, { repo: 'shop' }),
        node(logger, { repo: 'shop' }),
        ...['format', 'stamp', 'redact', 'write'].map((name) => node(`shop#log.ts:Logger.${name}`, { repo: 'shop' })),
        node('db_query:shop#repo.ts:3:1', { type: 'db_query', repo: 'shop' }),
        node('table:shop#orders', { type: 'table', repo: 'shop' }),
        node('http_out:shop#s.ts:40:1', { type: 'http_out', repo: 'shop' }),
        entry('entry:mail:http:POST:/send', { repo: 'mail' }),
        node('mail#m.ts:Mailer.send', { repo: 'mail' }),
      ],
      edges: [
        edge(route, 'shop#c.ts:Controller.create', { type: 'handles' }),
        edge('shop#c.ts:Controller.create', logger, { line: 1 }),
        ...methods.map((id, index) => edge('shop#c.ts:Controller.create', id, { line: 2 + index })),
        edge('shop#c.ts:Controller.create', 'shop#s.ts:Service.notify', { line: 9 }),
        ...methods.flatMap((id) => [edge(id, logger, { line: 1 }), edge(id, helper, { line: 2 })]),
        edge('shop#s.ts:Service.notify', logger, { line: 1 }),
        edge('shop#s.ts:Service.notify', 'http_out:shop#s.ts:40:1', { line: 40 }),
        edge(helper, logger, { line: 1 }),
        edge(helper, 'db_query:shop#repo.ts:3:1', { line: 3 }),
        edge('db_query:shop#repo.ts:3:1', 'table:shop#orders', { type: 'queries' }),
        edge(logger, 'shop#log.ts:Logger.format', { line: 1 }),
        edge(logger, 'shop#log.ts:Logger.write', { line: 2 }),
        edge('shop#log.ts:Logger.format', 'shop#log.ts:Logger.stamp', { line: 1 }),
        edge('shop#log.ts:Logger.format', 'shop#log.ts:Logger.redact', { line: 2 }),
        edge('http_out:shop#s.ts:40:1', 'entry:mail:http:POST:/send', { type: 'http_calls' }),
        edge('entry:mail:http:POST:/send', 'mail#m.ts:Mailer.send', { type: 'handles' }),
      ],
    };
  };

  it('expands a helper called by three methods once, and names where under the other two', () => {
    const db = buildTestDb(plumbing());
    const rows = flatten(buildFlowTree(db, route, {}).root).filter((item) => item.node.id === helper);
    expect(rows).toHaveLength(3);
    expect(rows.filter((item) => item.node.ref !== true)).toHaveLength(1);
    const own = rows.find((item) => item.node.ref !== true)!;
    expect(own.children.map((child) => child.node.id)).toEqual([logger, 'db_query:shop#repo.ts:3:1']);
    expect(rows.filter((item) => item.node.ref === true).map((item) => [item.node.seenAt, item.children])).toEqual([
      ['shop#s.ts:Service.a', []],
      ['shop#s.ts:Service.a', []],
    ]);
    db.close();
  });

  it('expands no node twice in one walk', () => {
    const db = buildTestDb(plumbing());
    const own = flatten(buildFlowTree(db, route, {}).root).filter((item) => item.node.ref !== true).map((item) => item.node.id);
    expect(new Set(own).size).toBe(own.length);
    db.close();
  });

  it('reaches the crossing four hops down within ten rows, the logger shared by every method notwithstanding', () => {
    const db = buildTestDb(plumbing());
    const flow = buildFlowTree(db, route, { maxNodes: 10 });
    const ids = flatten(flow.root).map((item) => item.node.id);
    expect(ids).toHaveLength(10);
    expect(ids).toContain('entry:mail:http:POST:/send');
    expect(flow.stoppedBy).toEqual(['maxNodes']);
    db.close();
  });

  it('writes a node\'s children in call order whichever of them got room', () => {
    const db = buildTestDb(plumbing());
    const { root } = buildFlowTree(db, route, { maxNodes: 10 });
    const controller = root.children[0]!;
    // The logger is first in call order and last in the budget: it is written
    // first, and the request behind `notify` was given room before the logger's
    // own body was.
    expect(controller.children.map((child) => child.node.id)).toEqual([
      logger,
      'shop#s.ts:Service.a',
      'shop#s.ts:Service.b',
      'shop#s.ts:Service.c',
      'shop#s.ts:Service.notify',
    ]);
    expect(controller.children[0]?.children).toEqual([]);
    db.close();
  });

  it('counts exactly what the node budget left out, and names the crossing it did not follow', () => {
    const db = buildTestDb(plumbing());
    const full = flatten(buildFlowTree(db, route, {}).root).length;
    const flow = buildFlowTree(db, route, { maxNodes: 7 });
    expect(flatten(flow.root)).toHaveLength(7);
    expect(flow.left).toBe(full - 7);
    expect(flow.truncated).toBe(`${full - 7} more nodes past maxNodes 7; raise maxNodes or ask get_flow on a child id`);
    expect(flow.crossingsLeft?.[0]).toEqual({
      from: 'shop#s.ts:Service.notify',
      to: 'http_out:shop#s.ts:40:1',
      type: 'calls',
      service: 'shop',
    });
    db.close();
  });

  it('names depth, not the budget, when depth stopped it', () => {
    const db = buildTestDb(plumbing());
    const flow = buildFlowTree(db, route, { depth: 2 });
    expect(flow.stoppedBy).toEqual(['depth']);
    expect(flow.truncated).toMatch(/^≥\d+ more nodes past depth 2; raise depth$/);
    db.close();
  });

  it('names both limits when both cut, the one that cut more in the sentence', () => {
    const db = buildTestDb(plumbing());
    // Room for `notify` and `a` under the controller, at the depth line: the
    // budget leaves out three of its children, the depth the four below those two.
    const flow = buildFlowTree(db, route, { depth: 2, maxNodes: 4 });
    expect(flow.stoppedBy).toEqual(['depth', 'maxNodes']);
    expect(flow.truncated).toBe('≥4 more nodes past depth 2; raise depth');
    expect(flow.left).toBe(7);
    db.close();
  });

  it('stops at the character ceiling and says so', () => {
    const db = buildTestDb(plumbing());
    const flow = buildFlowTree(db, route, { maxChars: 1500 });
    expect(flow.stoppedBy).toEqual(['maxChars']);
    expect(flow.truncated).toMatch(/^\d+ more nodes past about 1500 characters; raise maxChars or ask get_flow on a child id$/);
    expect(JSON.stringify(flow.root).length).toBeLessThan(3000);
    db.close();
  });

  it('writes a first row larger than the ceiling without its children', () => {
    const db = buildTestDb(plumbing());
    const flow = buildFlowTree(db, route, { maxChars: 10 });
    expect(flow.root.children.map((child) => child.node.id)).toEqual(['shop#c.ts:Controller.create']);
    expect(flow.root.children[0]?.children).toEqual([]);
    expect(flow.stoppedBy).toEqual(['maxChars']);
    db.close();
  });

  it('says nothing about a cut when nothing was cut', () => {
    const db = buildTestDb(plumbing());
    const flow = buildFlowTree(db, route, {});
    expect(flow.truncated).toBeUndefined();
    expect(flow.stoppedBy).toBeUndefined();
    expect(flow.crossingsLeft).toBeUndefined();
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

  it('counts exactly what it left out, and where the next page starts', () => {
    const { items, truncated, nextOffset, total } = truncate([1, 2, 3, 4, 5], 2);
    expect(items).toEqual([1, 2]);
    expect(truncated).toBe('3 more; next page offset 2');
    expect(nextOffset).toBe(2);
    expect(total).toBe(5);
  });

  it('reads on from an offset, and says nothing more on the last page', () => {
    expect(truncate([1, 2, 3, 4, 5], 2, 2)).toEqual({
      items: [3, 4],
      total: 5,
      truncated: '1 more; next page offset 4',
      nextOffset: 4,
    });
    expect(truncate([1, 2, 3, 4, 5], 2, 4)).toEqual({ items: [5], total: 5 });
  });

  it('answers an offset past the end with an empty page and the total', () => {
    expect(truncate([1, 2], 5, 9)).toEqual({ items: [], total: 2 });
  });

  it('says nothing about truncation when nothing was cut', () => {
    expect(truncate([1, 2], 5).truncated).toBeUndefined();
    expect(truncate([1, 2], 5).nextOffset).toBeUndefined();
  });
});
