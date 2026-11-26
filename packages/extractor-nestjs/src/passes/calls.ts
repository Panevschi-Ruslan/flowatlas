import {
  causeMeta,
  FRAMEWORK_CALLS_META,
  findMethod,
  methodNamedOn,
  forEachCall,
  lineOf,
  methodBodies,
  resolveReceiver,
  isDispatchedTableMember,
  tableDispatchOf,
  tableDispatchOfName,
  tableTargetOf,
  tableUnreadHint,
  whyNoClass,
  type FrameworkCallTime,
  type NamedFunction,
  type TableDispatch,
} from '@flowatlas/core';
import type { ClassDeclaration, Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import type { NestExtractContext } from '../context.js';
import type { ClassRole } from '../index-classes.js';
import { functionNamedBy, memberFunctionCalled } from './called-function.js';
import { definePass } from './types.js';

const WALKED: ReadonlySet<ClassRole> = new Set([
  'controller',
  'injectable',
  'guard',
  'interceptor',
  'pipe',
  'middleware',
  'plain',
]);

const MODULE_REF = new Set(['ModuleRef', 'LazyModuleLoader']);

/** The body being walked, and how what it reaches is recorded. */
interface Caller {
  /** Repo-relative path the calls are written in. */
  file: string;
  /** How the caller is named in a report: `OrdersService.create`, or `cancelOrder`. */
  label: string;
  id: string;
  /** The class the body belongs to, absent when it belongs to none. */
  owner?: ClassDeclaration;
  /** Creates the caller's own node, which nothing does until it has an edge. */
  ensure(): void;
  /**
   * Functions written in the body that a way in names as its handler (P398,
   * P399): a call inside one is drawn from that function's own node, which
   * the way in reaches, and not again from the method around it, which runs
   * it only to register it.
   */
  handlersInside?: ReadonlySet<TsNode>;
}

/**
 * Which calls on a function a walk follows, and what to do with each.
 *
 * `byName` is a bare `send()`, followed only when walking a function: following
 * every helper a method calls would make a node of every function in the
 * repository. `byMember` is `commands.myOrders()` — a module of functions is
 * not a helper but where a class keeps behaviour that has no class of its own,
 * and the call names which one, so a method's walk follows it too. A walk that
 * gives only `byName` follows both through it.
 *
 * A helper a method calls by name is not lost: once every reader has said which
 * functions the graph holds, `held-calls.ts` draws the calls that lead to one
 * (R156).
 */
interface Follow {
  byName?: (fn: NamedFunction, call: TsNode, meta?: EdgeMeta) => void;
  byMember?: (fn: NamedFunction, call: TsNode, meta?: EdgeMeta) => void;
}

/** What an edge drawn through a table of handlers carries: `via: "table"` and the key that selects the element (P398). */
type EdgeMeta = Readonly<Record<string, string>>;

/** How many tables inside the functions a table holds are followed before the walk stops. */
const TABLE_DEPTH = 3;

/**
 * A call through an element of a table the code writes out (P398): an edge to
 * what each element's member runs - a method, a function, or the calls of a
 * function written in the element, walked as the caller's own - each marked
 * `via: "table"` with the key that selects it. Elements whose member is not
 * read keep the call's gap, with how many.
 */
const followTable = (
  ctx: NestExtractContext,
  caller: Caller,
  call: TsNode & { getExpression(): TsNode },
  dispatch: TableDispatch,
  follow: Follow,
  depth: number,
): void => {
  let unreadValues = 0;
  for (const row of dispatch.rows) {
    const target = tableTargetOf(row.value);
    const meta: EdgeMeta = { via: 'table', ...(row.selectedBy === undefined ? {} : { selectedBy: row.selectedBy }) };
    if (target === undefined) {
      unreadValues += 1;
      continue;
    }
    if (target.kind === 'method') {
      const toId = ctx.methodIdOf(target.method);
      if (toId === undefined) {
        unreadValues += 1;
        continue;
      }
      caller.ensure();
      ctx.ensureMethodNode(target.method);
      ctx.builder.addEdge({ from: caller.id, to: toId, type: 'calls', confidence: 'static', file: caller.file, line: lineOf(call), meta: { ...meta } });
      continue;
    }
    const onFunction = follow.byName ?? follow.byMember;
    if (target.kind === 'function') {
      if (onFunction === undefined) unreadValues += 1;
      else onFunction(target.fn, call, meta);
      continue;
    }
    // A function written in the element runs as part of this call: its calls are the caller's.
    const body = target.fn.getBody();
    if (body === undefined) continue;
    const { owner: _owner, ...rest } = caller;
    const inner: Caller = target.owner === undefined ? rest : { ...rest, owner: target.owner };
    walkCalls(ctx, inner, body, onFunction === undefined ? follow : { ...follow, byName: onFunction }, meta, depth + 1);
  }
  if (dispatch.unread + unreadValues === 0) return;
  ctx.report({
    file: caller.file,
    line: lineOf(call),
    reason: 'call-dynamic-receiver',
    level: 'info',
    hint: tableUnreadHint(dispatch, unreadValues),
    symbol: `${caller.label} -> ${call.getExpression().getText()}`,
    ...causeMeta({ cause: 'table-rows-unread' }),
  });
};

/** Whether an entry adapter's ways in stand for a call (P399): see `EntryAdapter.standsForCall`. */
const standsForWaysIn = (ctx: NestExtractContext, call: TsNode): boolean =>
  ctx.adapters.entry.some((adapter) => adapter.standsForCall?.(call) === true);

/**
 * Draws the edges one body's calls stand for.
 *
 * Only a receiver the checker resolves to a class of this repository produces an
 * edge. A receiver from an installed package is a leaf that a later phase turns
 * into data or network access, so it is counted rather than reported; a receiver
 * nothing can pin down is reported rather than guessed. What it does with a call
 * on a function rather than on a class is `follow`'s to say.
 */
const walkCalls = (
  ctx: NestExtractContext,
  caller: Caller,
  body: TsNode,
  follow: Follow = {},
  edgeMeta?: EdgeMeta,
  depth = 0,
): void => {
  const withMeta = (meta?: Readonly<Record<string, string>>): { meta?: Record<string, string> } =>
    meta === undefined && edgeMeta === undefined ? {} : { meta: { ...meta, ...edgeMeta } };
  // Inside a function a table holds, every edge says it came through the table.
  const named: Follow =
    edgeMeta === undefined
      ? follow
      : {
          ...(follow.byName === undefined ? {} : { byName: (fn: NamedFunction, call: TsNode) => follow.byName?.(fn, call, edgeMeta) }),
          ...(follow.byMember === undefined ? {} : { byMember: (fn: NamedFunction, call: TsNode) => follow.byMember?.(fn, call, edgeMeta) }),
        };
  const handlers = caller.handlersInside;
  forEachCall(body, (call) => {
    const callee = call.getExpression();

    // A call written in a function a way in names as its handler is that
    // function's, drawn from its own node, which the way in reaches; not again
    // from the method it is written in, which runs it only to register it
    // (P398 for calls through a table, P399 for every call).
    if (handlers !== undefined && call.getFirstAncestor((node) => handlers.has(node)) !== undefined) return;

    // `route.handler(ctx)` where `route` is an element of a table written out,
    // and `const { handler } = route; handler(ctx)`: a call of each element's
    // member (P398).
    if (depth < TABLE_DEPTH) {
      const dispatch = Node.isIdentifier(callee)
        ? tableDispatchOfName(callee, call)
        : Node.isPropertyAccessExpression(callee)
          ? tableDispatchOf(callee.getExpression(), callee.getName(), call)
          : undefined;
      if (dispatch !== undefined) {
        // A call whose table's elements are ways in of their own (a bot's listener split by prefix, P399): each way in
        // hands the update to its element, so the call is theirs, with nothing left unread.
        if (!standsForWaysIn(ctx, call)) followTable(ctx, caller, call, dispatch, named, depth);
        return;
      }
    }

    if (!Node.isPropertyAccessExpression(callee)) {
      if (Node.isIdentifier(callee) && named.byName !== undefined) {
        const fn = functionNamedBy(callee);
        if (fn !== undefined) named.byName(fn, call);
        return;
      }
      if (Node.isElementAccessExpression(callee)) {
        ctx.report({
          file: caller.file,
          line: lineOf(call),
          reason: 'call-dynamic-receiver',
          level: 'info',
          hint: 'The method is chosen at run time; nothing static to point at.',
          symbol: `${caller.label} -> ${callee.getText()}`,
          ...causeMeta({ cause: 'dynamic-member' }),
        });
      }
      return;
    }

    const receiverExpr = callee.getExpression();
    const calledName = callee.getName();

    // `commands.myOrders(ctx)` on `export const commands = { myOrders: … }` —
    // a module of functions spelled as an object, followed like a function
    // called by name.
    const onMember = named.byMember ?? named.byName;
    if (onMember !== undefined) {
      const member = memberFunctionCalled(callee);
      if (member !== undefined) {
        onMember(member, call);
        return;
      }
    }

    const receiver = resolveReceiver(receiverExpr, caller.owner, ctx.di);

    // A language built-in says nothing about the shape of the system, and an
    // injection that already failed was reported once at the constructor.
    if (receiver.kind === 'builtin' || receiver.diUnresolved === true) return;

    if (receiver.external !== undefined) {
      if (MODULE_REF.has(receiver.external.typeName)) {
        ctx.report({
          file: caller.file,
          line: lineOf(call),
          reason: 'call-module-ref',
          hint: 'Resolved through the container at run time; inject the class instead to make the edge visible.',
          symbol: `${caller.label} -> ${receiver.text}.${calledName}`,
          ...causeMeta({ cause: 'container-lookup' }),
        });
        return;
      }
      ctx.countExternalCall(receiver.external.package);
      return;
    }

    if (receiver.token !== undefined) {
      ctx.report({
        file: caller.file,
        line: lineOf(call),
        reason: 'call-through-token',
        hint: `Cannot follow a value provided for ${receiver.token}; provide it with useClass to make calls visible.`,
        symbol: `${caller.label} -> ${receiver.text}.${calledName}`,
        ...causeMeta({ cause: 'untyped-di-token' }),
      });
      return;
    }

    if (receiver.classDecl === undefined) {
      // `handler: this.h.bind(this)` in a table a call here dispatches over is
      // a reference that dispatch follows, not a call nothing could (P398).
      if (calledName === 'bind' && isDispatchedTableMember(call)) return;
      ctx.report({
        file: caller.file,
        line: lineOf(call),
        reason: 'call-dynamic-receiver',
        level: 'info',
        hint: 'The receiver has no single class type; inject a class to make the edge visible.',
        symbol: `${caller.label} -> ${receiver.text}.${calledName}`,
        // Why it has none, as the code says it (P75): a package nobody
        // installed, a callback nobody typed, a method picked by a key.
        ...causeMeta(whyNoClass(receiverExpr, caller.owner)),
      });
      return;
    }

    const found = findMethod(receiver.classDecl, calledName);
    if (found.externalPackage !== undefined) {
      ctx.countExternalCall(found.externalPackage);
      return;
    }
    if (found.method === undefined) {
      ctx.report({
        file: caller.file,
        line: lineOf(call),
        reason: 'call-dynamic-receiver',
        // The compiler agreed the member exists, and a field holding a function
        // written in place is read as the method it is, so what is left is a
        // field given its function from somewhere else: no one body to follow.
        level: 'info',
        hint: `${calledName} on ${receiver.classDecl.getName() ?? receiver.text} is a field assigned a function from elsewhere, so there is no one body to follow. Declare it as a method to make the edge visible.`,
        symbol: `${caller.label} -> ${receiver.text}.${calledName}`,
        ...causeMeta({ cause: 'function-field' }),
      });
      return;
    }

    const toId = ctx.methodIdOf(found.method);
    if (toId === undefined) return;
    caller.ensure();
    ctx.ensureMethodNode(found.method);
    ctx.builder.addEdge({
      from: caller.id,
      to: toId,
      type: 'calls',
      confidence: 'static',
      file: caller.file,
      line: lineOf(call),
      ...withMeta(receiver.kind === 'super' ? { via: 'super' } : undefined),
    });
  });
};

/**
 * Writes the edge one caller makes to one function, whatever the caller is.
 *
 * A method and a function reach a function the same way and record it the same
 * way; what differs is the bookkeeping each walk does afterwards, which stays
 * with the walk.
 */
const callsFunction =
  (ctx: NestExtractContext, from: { id: string; file: string }, ensure: () => void) =>
  (called: NamedFunction, call: TsNode, meta?: EdgeMeta): void => {
    ensure();
    ctx.ensureFunctionNode(called);
    ctx.builder.addEdge({
      from: from.id,
      to: ctx.functionIdOf(called),
      type: 'calls',
      confidence: 'static',
      file: from.file,
      line: lineOf(call),
      ...(meta === undefined ? {} : { meta: { ...meta } }),
    });
  };

/**
 * Every method of every class whose role means its body is worth reading.
 *
 * Returns the functions those methods called by name through a module of
 * functions, so the walk that follows functions starts from them too: an edge
 * to a handler nobody reads the body of stops exactly where the flow was about
 * to become interesting.
 */
const walkClasses = (ctx: NestExtractContext): NamedFunction[] => {
  const reached: NamedFunction[] = [];
  // Functions a way in names, written inside a method: walked as handlers of their own below.
  const handlersInside: ReadonlySet<TsNode> = new Set(ctx.handlerFunctions.map((fn) => fn.declaration));
  for (const indexed of ctx.classes.all()) {
    if (!WALKED.has(indexed.role)) continue;
    const owner: ClassDeclaration = indexed.declaration;

    for (const { declaration: method, body } of methodBodies(owner)) {
      const id = ctx.methodIdOf(method);
      if (id === undefined) continue;
      let created = false;

      walkCalls(
        ctx,
        {
          file: indexed.file,
          label: `${indexed.name}.${method.getName()}`,
          id,
          owner,
          ensure: () => {
            if (created) return;
            ctx.ensureMethodNode(method);
            created = true;
          },
          handlersInside,
        },
        body,
        {
          byMember: (called, call, meta) => {
            callsFunction(ctx, { id, file: indexed.file }, () => ctx.ensureMethodNode(method))(
              called,
              call,
              meta,
            );
            reached.push(called);
          },
        },
      );
    }
  }
  return reached;
};

/**
 * The class `this` means inside a function, when it means one.
 *
 * Only an arrow keeps the `this` it was written under. A `function`, and a
 * method written in an object literal, are handed a `this` of the caller's
 * choosing, so walking out stops at the first of those; an arrow written in a
 * class member reads the class.
 */
const lexicalClassOf = (declaration: NamedFunction['declaration']): ClassDeclaration | undefined => {
  const start: TsNode = Node.isPropertyAssignment(declaration) || Node.isVariableDeclaration(declaration)
    ? (declaration.getInitializer() ?? declaration)
    : declaration;
  if (!Node.isArrowFunction(start)) return undefined;
  for (let at: TsNode | undefined = start.getParent(); at !== undefined; at = at.getParent()) {
    if (Node.isClassDeclaration(at)) return at;
    if (Node.isFunctionDeclaration(at) || Node.isFunctionExpression(at)) return undefined;
    if (Node.isMethodDeclaration(at) && !Node.isClassDeclaration(at.getParent())) return undefined;
  }
  return undefined;
};

/**
 * The functions an entry point names, and what they reach.
 *
 * A project that keeps its handlers in a table of `key -> function` has no class
 * between the button and the service it calls, so without this the flow stops at
 * the way in. The walk starts only at functions an adapter named as a handler
 * and spreads through the functions those call, which keeps the graph to what is
 * reachable from an entry point rather than to every function in the repository.
 */
const walkHandlerFunctions = (ctx: NestExtractContext, alsoReached: readonly NamedFunction[]): void => {
  const queue: NamedFunction[] = [];
  const visited = new Set<NamedFunction['declaration']>();
  // Two ways in may name the same handler, and it is still one body to read.
  for (const fn of [...ctx.handlerFunctions, ...alsoReached]) {
    if (visited.has(fn.declaration)) continue;
    visited.add(fn.declaration);
    queue.push(fn);
  }

  for (let at = 0; at < queue.length; at += 1) {
    const fn = queue[at] as NamedFunction;
    const file = ctx.fileOf(fn.declaration);
    const id = ctx.functionIdOf(fn);

    // A function written in a class — a handler passed to a registration made in
    // a method — still reads `this` as that class, so its calls are followed
    // exactly as the method's own would be.
    const owner = lexicalClassOf(fn.declaration);
    walkCalls(
      ctx,
      {
        file,
        label: fn.name,
        id,
        ...(owner === undefined ? {} : { owner }),
        ensure: () => ctx.ensureFunctionNode(fn),
      },
      fn.body,
      {
        byName: (called, call, meta) => {
          callsFunction(ctx, { id, file }, () => ctx.ensureFunctionNode(fn))(called, call, meta);
          if (visited.has(called.declaration)) return;
          visited.add(called.declaration);
          queue.push(called);
        },
      },
    );
  }
};

/**
 * The lifecycle hooks Nest calls by itself on every provider and controller it
 * builds, and when (the framework's lifecycle events): the application starts,
 * or it stops.
 */
const NEST_HOOKS: ReadonlyMap<string, FrameworkCallTime> = new Map([
  ['onModuleInit', 'startup'],
  ['onApplicationBootstrap', 'startup'],
  ['onModuleDestroy', 'shutdown'],
  ['beforeApplicationShutdown', 'shutdown'],
  ['onApplicationShutdown', 'shutdown'],
]);

/**
 * Marks the lifecycle hooks Nest calls (P399): on a controller or a provider
 * a module of the repository registers (a class, or a `useClass`), each hook
 * it declares whose node the walk drew is written `frameworkCalls: { hook,
 * when }`, so what answers reach reads it as a way in - `startup
 * (onModuleInit)` - and a method only it calls (`setup()`) as reached. A hook
 * on a class no module registers is left as it was: nothing says Nest builds
 * that class.
 */
const markLifecycleHooks = (ctx: NestExtractContext): void => {
  const registered = new Set<ClassDeclaration>();
  for (const module of ctx.modules.all()) {
    for (const controller of module.controllers) registered.add(controller);
    for (const provider of [...module.providers, ...(module.dynamicProviders ?? [])]) {
      if (provider.declaration !== undefined && (provider.kind === 'class' || provider.kind === 'useClass')) registered.add(provider.declaration);
    }
  }
  if (registered.size === 0) return;
  for (const indexed of ctx.classes.all()) {
    if (!WALKED.has(indexed.role) || !registered.has(indexed.declaration)) continue;
    for (const [hook, when] of NEST_HOOKS) {
      const method = methodNamedOn(indexed.declaration, hook);
      const id = method === undefined ? undefined : ctx.methodIdOf(method);
      const node = id === undefined ? undefined : ctx.builder.getNode(id);
      if (node === undefined) continue;
      node.meta = { ...node.meta, [FRAMEWORK_CALLS_META]: { hook, when } };
    }
  }
};

/** Turns call sites into edges between the things that hold them. */
export const callsPass = definePass('calls', (ctx: NestExtractContext) => {
  const reached = walkClasses(ctx);
  walkHandlerFunctions(ctx, reached);
  markLifecycleHooks(ctx);
});
