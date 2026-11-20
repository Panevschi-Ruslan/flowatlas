import {
  conditionsHold,
  definePass,
  forEachCall,
  isServiceSource,
  lineAndColumnAt,
  makeChannelId,
  makeEntryId,
  makeHttpEntryKey,
  makeLeafId,
  methodsOfClass,
  normalizePath,
  readWorkerConfig,
  resolveTypeOrigin,
  STREAM_KIND,
  type Confidence,
  type ExtractorPass,
  type GraphEdge,
  type GraphNode,
  type LocatorContext,
  type NamedFunction,
} from '@flowatlas/core';
import { scopesOf, type PassContext, type Scope } from '@flowatlas/extract-scopes';
import type { CallExpression, ClassDeclaration, Node as TsNode, ParameterDeclaration, SourceFile } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import type { BrokerSpec, SubscriberPattern } from './adapters/index.js';
import { addressOf, collapsed, readAddress } from './address.js';
import { brokerSpecsFor } from './brokers-pass.js';
import { methodMatches, receiverEvidence, receiverIsFrom, type ReceiverEvidence } from './call-site.js';
import { isResolved, nameForKind, resolveChannelName, type ChannelResolution } from './channel-name.js';
import {
  branchView,
  constructorBodyOf,
  enclosingTests,
  heldFieldsIn,
  methodBodyOf,
  objectReader,
  requestPathOf,
  routePathOf,
  writesHeld,
  type ObjectClass,
  type StubCall,
} from './durable-objects.js';

/**
 * Routes that relay a channel onto a stream of server-sent events (P359).
 *
 * A screen that reacts to a message is fed through a route: the route's handler
 * subscribes to a channel on the broker and writes each message it receives to
 * the stream the browser holds open. Read separately, the two halves are a
 * route nobody publishes to and a channel whose only consumer is a method that
 * registered a listener, and the question "which screen handles this message"
 * has no answer.
 *
 * So a route whose handler serves a stream - Nest's `@Sse`, Hono's
 * `streamSSE`/`writeSSE`, an answer of type `text/event-stream`, frames written
 * as `data: …` - is read for the subscriptions in the code behind it: its
 * handler, and the functions and methods that handler calls, a few calls deep.
 * A subscription is any call a broker description reads as one, with the same
 * descriptions, receivers and channel reading the consumers are read with; one
 * made through a helper of the project's own whose channel is its parameter is
 * read at the call that hands the helper its channel. Each channel found makes
 * the route a consumer of it: a `consumer` node for the route's handler, marked
 * with the route it relays to (`meta.relay`), that the channel `consumes` into.
 * The linker then hands each channel on to the screens holding the stream open.
 *
 * A request handed to a per-scope object - a Durable Object's stub, `fetch`
 * or a method of its own called on it (P361) - is followed into the class the
 * object is made of (`durable-objects.ts`), into the branch of its `fetch` the
 * request's path takes, and the stream and the subscriptions are looked for
 * there as in the route's own code; a subscription the object opens in its
 * constructor or its alarm counts where it feeds the streams the object holds.
 * An object that holds the streams open and writes to them from a method the
 * project calls on its stub elsewhere is the hub of a channel of its own,
 * `durable-object:<Class>`: each such call is a producer of it, and the route
 * a consumer.
 *
 * A stream with no subscription found behind it - an rxjs pipeline over a
 * subject, an object whose class is not read, a channel in a value not read -
 * is a row on the route, never silence.
 */

/** How many calls out from the handler the code behind a stream is looked for. */
const STREAM_DEPTH = 3;

/** How many bodies that walk reads, at most, for one route. */
const MOST_BODIES = 40;

/** How deep the calls are looked at for what makes the answer a stream: the handler and what it calls directly. */
const SHAPE_DEPTH = 1;

/** How many helpers out a channel handed in as a parameter is followed. */
const HANDED_DEPTH = 3;

/** How a route was seen to answer with a stream. */
type StreamShape = 'decorator' | 'helper' | 'content-type' | 'frames';

/** A body that calls another, at a line; and the call, where the checker named it. */
interface Caller {
  readonly scope: Scope;
  readonly line: number;
  readonly call?: CallExpression;
}

/** One body behind a route, and the calls that reached it. */
interface Reached {
  readonly scope: Scope;
  readonly depth: number;
  /** How many calls out from where the stream would be answered: the route's handler, or an object's method the request is handed to. */
  readonly shapeDepth: number;
  /** How many calls further the walk goes from here. */
  readonly left: number;
  /** Reached through an object's `fetch` whose branch the request takes was not read. */
  readonly weak: boolean;
  /** The class of the per-scope object the body belongs to, where it was reached through a stub. */
  readonly object?: ClassDeclaration;
  readonly callers: readonly Caller[];
}

/** A request handed to a per-scope object, followed or not. */
interface Hop {
  readonly stub: StubCall;
  readonly file: string;
  readonly line: number;
  /** The class's method was reached. */
  readonly entered: boolean;
  readonly weak: boolean;
  /** Why it was not followed. */
  readonly why?: string;
  readonly hint?: string;
}

/** The name of the channel a per-scope object is the hub of. */
const HUB_PREFIX = 'durable-object:';
const HUB_ADAPTER = 'durable-object';

/** A method of an object the platform calls, never a project's caller through a stub. */
const PLATFORM_HOOK = /^(?:constructor|fetch|alarm|webSocket\w*)$/;

/** Words a repository's code holds where it could reach a per-scope object at all. */
const OBJECT_WORDS = /\bidFrom(?:Name|String)\b|\bnewUniqueId\b|\bgetByName\b|\bDurableObject(?:Namespace|Stub)?\b/;

/** Whether a repository could reach a per-scope object at all: its worker configuration binds one, or its code names one. */
const mayHoldObjects = (repoDir: string, sources: readonly SourceFile[]): boolean =>
  (readWorkerConfig(repoDir)?.objects.length ?? 0) > 0 || sources.some((source) => isServiceSource(source.getFilePath(), repoDir) && OBJECT_WORDS.test(source.getFullText()));

/** Whether an object's method tells the paths of the requests it is handed apart. */
const tellsPathsApart = (body: TsNode): boolean => branchView(body, '/').branched;

/** Whether a body of an object writes to the streams it holds, itself or through a method of the object it calls. */
const feedsHeld = (declaration: ClassDeclaration, body: TsNode, held: ReadonlySet<string>, leaveOut?: ReadonlySet<TsNode>): boolean => {
  if (writesHeld(body, held, leaveOut)) return true;
  let feeds = false;
  forEachCall(body, (node) => {
    if (feeds) return;
    const callee = node.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || callee.getExpression().getKind() !== SyntaxKind.ThisKeyword) return;
    const own = methodBodyOf(declaration, callee.getName());
    if (own !== undefined && own.body !== body && writesHeld(own.body, held)) feeds = true;
  }, leaveOut);
  return feeds;
};

/** Why a stub's class was not followed, and what to do about it. */
const unfollowed = (target: ObjectClass, method: string): { why: string; hint: string } => {
  switch (target.kind) {
    case 'undeclared':
      return {
        why: `no worker configuration of this repository binds ${target.binding} under durable_objects, and the namespace's type names no class`,
        hint: `Declare ${target.binding} under durable_objects.bindings in the worker's wrangler file with its class_name, or type the namespace as DurableObjectNamespace<Class>.`,
      };
    case 'missing':
      return {
        why: `${target.file} binds ${target.binding} to the class ${target.className}, which this repository does not declare`,
        hint: `Export ${target.className} from the worker's entry, or correct class_name in ${target.file}.`,
      };
    case 'elsewhere':
      return {
        why: `${target.file} binds ${target.binding} to the class ${target.className} of the worker ${target.scriptName}, whose code is read with that worker`,
        hint: `Annotate the handler with @Consumes('<channel>') for what ${target.className} relays.`,
      };
    case 'unread':
      return {
        why: 'the namespace the stub is asked of is not read as a binding of the environment',
        hint: 'Reach the namespace as env.<BINDING>, or type it as DurableObjectNamespace<Class>.',
      };
    case 'class':
      return {
        why: `the class ${target.className} declares no method ${method} in this repository`,
        hint: `Annotate the handler with @Consumes('<channel>') for what ${target.className} relays.`,
      };
  }
};

/** One channel the code behind a stream subscribes to. */
interface Relayed {
  readonly name: string;
  readonly spec: BrokerSpec;
  readonly confidence: Confidence;
  readonly file: string;
  readonly line: number;
}

const lineOf = (node: TsNode): number => lineAndColumnAt(node.getSourceFile(), node.getStart()).line;

/** Whether a string written in the code is the content type of a stream. */
const EVENT_STREAM = 'text/event-stream';

/** A frame of the protocol written out: `data: …` up to a line break. */
const FRAME = /^[`'"]data:[\s\S]*\\n/;

/** Hono's helper that answers with a stream, and the method that writes one frame of it. */
const STREAM_HELPER = 'streamSSE';
const FRAME_WRITER = 'writeSSE';

/** Whether the name a call is made by is imported from one of the module prefixes given. */
const importedFrom = (callee: TsNode, prefix: string): boolean => {
  const declaration = callee.getSymbol()?.getDeclarations()[0];
  const imported = declaration?.getFirstAncestor((at) => Node.isImportDeclaration(at));
  if (imported === undefined || !Node.isImportDeclaration(imported)) return false;
  const module = imported.getModuleSpecifierValue();
  return module === prefix || module.startsWith(`${prefix}/`);
};

/** How one body shows that what it answers is a stream, if it does. */
const shapeIn = (body: TsNode, leaveOut?: ReadonlySet<TsNode>): StreamShape | undefined => {
  let found: StreamShape | undefined;
  const visit = (node: TsNode): void => {
    if (found !== undefined) return;
    if (Node.isCallExpression(node)) {
      const callee = node.getExpression();
      if (Node.isIdentifier(callee) && callee.getText() === STREAM_HELPER && importedFrom(callee, 'hono')) found = 'helper';
      else if (Node.isPropertyAccessExpression(callee) && callee.getName() === FRAME_WRITER) found = 'helper';
      return;
    }
    if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
      if (node.getLiteralText().toLowerCase().startsWith(EVENT_STREAM)) found = 'content-type';
      else if (FRAME.test(node.getText())) found = 'frames';
      return;
    }
    if (Node.isTemplateExpression(node) && FRAME.test(node.getText())) found = 'frames';
  };
  visit(body);
  body.forEachDescendant((node, traversal) => {
    if (leaveOut?.has(node) === true) {
      traversal.skip();
      return;
    }
    visit(node);
    if (found !== undefined) traversal.stop();
  });
  return found;
};

/** Whether a way in is declared with Nest's decorator for a stream. */
const declaredAsStream = (route: GraphNode): boolean => {
  const decorators = route.meta?.['decorators'];
  return Array.isArray(decorators) && decorators.some((decorator) => (decorator as { name?: unknown } | null)?.name === 'Sse');
};

/** The function a parameter belongs to, and where in its list it is. */
const positionOf = (parameter: ParameterDeclaration): number =>
  (parameter.getParent() as unknown as { getParameters(): ParameterDeclaration[] }).getParameters().indexOf(parameter);

/** The parameter a value is, where it is one of the function it is written in. */
const parameterBehind = (value: TsNode): ParameterDeclaration | undefined => {
  let at = value;
  while (Node.isParenthesizedExpression(at) || Node.isAsExpression(at) || Node.isNonNullExpression(at)) at = at.getExpression();
  if (!Node.isIdentifier(at)) return undefined;
  const declaration = at.getSymbol()?.getDeclarations()[0];
  return declaration !== undefined && Node.isParameterDeclaration(declaration) ? declaration : undefined;
};

/** The name a call is made by: the method's, or the function's. */
const calledName = (call: CallExpression): string | undefined => {
  const callee = call.getExpression();
  if (Node.isPropertyAccessExpression(callee)) return callee.getName();
  return Node.isIdentifier(callee) ? callee.getText() : undefined;
};

/** The name a body is called by. */
const nameOfScope = (scope: Scope): string | undefined => {
  if (scope.method !== undefined) return scope.method.getName();
  return scope.fn?.name.split('.').pop();
};

/** Whether a parameter is one of the body's own. */
const ownParameter = (scope: Scope, parameter: ParameterDeclaration): boolean => {
  const fn = parameter.getParent();
  const body = Node.isBodyable(fn) || Node.isBodied(fn) ? fn.getBody() : undefined;
  return body !== undefined && body === scope.body;
};

export const extractStreamRelays = (ctx: PassContext): void => {
  const routes = ctx.builder.nodes.filter((node) => node.type === 'entry' && node.kind === 'http');
  /**
   * The per-scope objects of this repository (P361) are asked of only where it
   * could have any: a worker configuration binds one, or its code names the
   * platform's namespace or the calls that make a stub. A repository with no
   * route may still be a plain worker whose own `fetch` hands streams to them.
   */
  const objectsInPlay = mayHoldObjects(ctx.repoDir, ctx.project.getSourceFiles());
  if (routes.length === 0 && !objectsInPlay) return;
  const specs = brokerSpecsFor(ctx);
  const subscribing = specs.flatMap((spec) =>
    (spec.subscriberPatterns ?? []).filter((pattern) => pattern.constructs === undefined).map((pattern) => ({ spec, pattern })),
  );

  const handlesFrom = new Map<string, GraphEdge[]>();
  const handlesTo = new Map<string, GraphEdge[]>();
  const callsFrom = new Map<string, GraphEdge[]>();
  const consumesTo = new Map<string, GraphEdge[]>();
  for (const edge of ctx.builder.edges) {
    const into = (index: Map<string, GraphEdge[]>, key: string): void => {
      const list = index.get(key);
      if (list === undefined) index.set(key, [edge]);
      else list.push(edge);
    };
    if (edge.type === 'handles') {
      into(handlesFrom, edge.from);
      into(handlesTo, edge.to);
    } else if (edge.type === 'calls') into(callsFrom, edge.from);
    else if (edge.type === 'consumes') into(consumesTo, edge.to);
  }
  const scopes = new Map<string, Scope>();
  const scopeByBody = new Map<TsNode, Scope>();
  for (const scope of scopesOf(ctx)) {
    if (!scopes.has(scope.id)) scopes.set(scope.id, scope);
    if (!scopeByBody.has(scope.body)) scopeByBody.set(scope.body, scope);
  }

  /**
   * The body a call lands in, where this repository declares it: asked of the
   * checker, because a call into a function is drawn only once every reader
   * has had its turn (R156), after this one.
   */
  const calleeScope = (call: CallExpression): Scope | undefined => {
    const callee = call.getExpression();
    const name = Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : Node.isIdentifier(callee) ? callee : undefined;
    const symbol = name?.getSymbol();
    const target = symbol?.getAliasedSymbol() ?? symbol;
    for (const declaration of target?.getDeclarations() ?? []) {
      const fn =
        Node.isVariableDeclaration(declaration) || Node.isPropertyDeclaration(declaration) || Node.isPropertyAssignment(declaration)
          ? declaration.getInitializer()
          : declaration;
      const body = fn !== undefined && (Node.isBodyable(fn) || Node.isBodied(fn)) ? fn.getBody() : undefined;
      const scope = body === undefined ? undefined : scopeByBody.get(body);
      if (scope !== undefined) return scope;
    }
    return undefined;
  };

  const objects = objectReader(ctx.repoDir, () => ctx.project.getSourceFiles(), (call) => calleeScope(call)?.body);

  /** The scope of a class's method, where the walk over the repository has one, or one made for the body. */
  const scopeOfMethod = (declaration: ClassDeclaration, name: string, body: TsNode): Scope =>
    scopeByBody.get(body) ?? {
      id: `${ctx.repo}#${ctx.fileOf(declaration)}:${declaration.getName() ?? 'default'}.${name}`,
      file: ctx.fileOf(declaration),
      body,
      owner: declaration,
      ensure: () => undefined,
    };

  /** A scope that leaves out the parts of its body a request does not reach. */
  const viewOf = (scope: Scope, leaveOut: ReadonlySet<TsNode>): Scope =>
    leaveOut.size === 0 ? scope : { ...scope, leaveOut: new Set([...(scope.leaveOut ?? []), ...leaveOut]) };

  /** The path a forwarded request asks for: the route's own, as written. */
  const pathOfRoute = (route: GraphNode | undefined): string | undefined => {
    const raw = route?.meta?.['rawPath'] ?? route?.meta?.['path'];
    return typeof raw === 'string' ? raw : undefined;
  };

  /**
   * The bodies behind a route, breadth first from its handler, into the
   * per-scope objects the request is handed to; and each request handed to
   * one, followed or not.
   */
  const behind = (handlers: readonly string[], route?: GraphNode): { bodies: Reached[]; hops: Hop[] } => {
    const reached = new Map<string, Reached & { callers: Caller[] }>();
    const hops: Hop[] = [];
    const reach = (scope: Scope, caller: Caller | undefined, at: Omit<Reached, 'scope' | 'callers'>): Reached | undefined => {
      const known = reached.get(scope.id);
      if (known !== undefined) {
        if (caller !== undefined && !known.callers.some((each) => each.scope === caller.scope && each.line === caller.line)) known.callers.push(caller);
        return undefined;
      }
      if (reached.size >= MOST_BODIES) return undefined;
      const made = { scope, ...at, callers: caller === undefined ? [] : [caller] };
      reached.set(scope.id, made);
      return made;
    };

    /** A request handed to an object: into the class's method, the branch of `fetch` its path takes. */
    const hop = (from: Reached, stub: StubCall, call: CallExpression): Reached | undefined => {
      const line = lineOf(call);
      const file = from.scope.file;
      const target = stub.target;
      const found = target.kind === 'class' ? methodBodyOf(target.declaration, stub.method) : undefined;
      if (target.kind !== 'class' || found === undefined) {
        hops.push({ stub, file, line, entered: false, weak: from.weak, ...unfollowed(target, stub.method) });
        return undefined;
      }
      let scope = scopeOfMethod(target.declaration, stub.method, found.body);
      let weak = from.weak;
      if (stub.method === 'fetch') {
        const requested = requestPathOf(call.getArguments()[0]);
        const path = requested.kind === 'path' ? requested.path : requested.kind === 'forwarded' ? pathOfRoute(route) : undefined;
        if (path === undefined) weak ||= tellsPathsApart(found.body);
        else scope = viewOf(scope, branchView(found.body, path).leaveOut);
      }
      hops.push({ stub, file, line, entered: true, weak });
      return reach(scope, { scope: from.scope, line, call }, { depth: from.depth + 1, shapeDepth: 0, left: STREAM_DEPTH, weak, object: target.declaration });
    };

    const walk = (start: Reached[]): void => {
      let frontier = start;
      while (frontier.length > 0 && reached.size < MOST_BODIES) {
        const next: Reached[] = [];
        for (const from of frontier) {
          if (from.left <= 0) continue;
          const onward = { depth: from.depth + 1, shapeDepth: from.shapeDepth + 1, left: from.left - 1, weak: from.weak, ...(from.object === undefined ? {} : { object: from.object }) };
          forEachCall(from.scope.body, (node) => {
            const call = node as unknown as CallExpression;
            const stub = objectsInPlay ? objects.stubCallOf(call) : undefined;
            if (stub !== undefined) {
              const entered = hop(from, stub, call);
              if (entered !== undefined) next.push(entered);
              return;
            }
            const scope = calleeScope(call);
            if (scope === undefined || scope === from.scope) return;
            const made = reach(scope, { scope: from.scope, line: lineOf(call), call }, onward);
            if (made !== undefined) next.push(made);
          }, from.scope.leaveOut);
          // A call the checker leaves open and the injection reading settled;
          // not from a body read for one branch, whose edges are the whole body's.
          if (from.scope.leaveOut !== undefined && from.scope.leaveOut.size > 0) continue;
          for (const edge of callsFrom.get(from.scope.id) ?? []) {
            const scope = scopes.get(edge.to);
            if (scope === undefined || scope === from.scope) continue;
            const made = reach(scope, { scope: from.scope, line: edge.line ?? 0 }, onward);
            if (made !== undefined) next.push(made);
          }
        }
        frontier = next;
      }
    };

    walk(
      handlers.flatMap((id) => {
        const scope = (route === undefined ? undefined : routeViews.get(route.id)) ?? scopes.get(id);
        const made = scope === undefined ? undefined : reach(scope, undefined, { depth: 0, shapeDepth: 0, left: STREAM_DEPTH, weak: false });
        return made === undefined ? [] : [made];
      }),
    );

    // What an object entered opens for every request - its constructor, its
    // alarm - where it feeds the streams the request's branch holds.
    const extra: Reached[] = [];
    for (const declaration of new Set([...reached.values()].flatMap((each) => (each.object === undefined ? [] : [each.object])))) {
      const own = [...reached.values()].filter((each) => each.object === declaration);
      const held = new Set(own.flatMap((each) => [...heldFieldsIn(each.scope.body, each.scope.leaveOut)]));
      if (held.size === 0) continue;
      const weak = own.every((each) => each.weak);
      const opened: { name: string; body: TsNode }[] = [];
      const constructorBody = constructorBodyOf(declaration);
      if (constructorBody !== undefined) opened.push({ name: 'constructor', body: constructorBody });
      const alarm = methodBodyOf(declaration, 'alarm');
      if (alarm !== undefined) opened.push({ name: 'alarm', body: alarm.body });
      for (const { name, body } of opened) {
        if (!feedsHeld(declaration, body, held)) continue;
        const made = reach(scopeOfMethod(declaration, name, body), undefined, { depth: 1, shapeDepth: SHAPE_DEPTH + 1, left: STREAM_DEPTH, weak, object: declaration });
        if (made !== undefined) extra.push(made);
      }
    }
    walk(extra);
    return { bodies: [...reached.values()], hops };
  };

  /** What the locators of a pattern may ask about a call beyond the call itself, as the consumers are read. */
  const contextOf = (receiver: TsNode, owner: ClassDeclaration | undefined): LocatorContext => {
    const declaration = resolveTypeOrigin(receiver)?.declaration;
    const provider = owner !== undefined && Node.isPropertyAccessExpression(receiver) ? ctx.di.lookup(owner, receiver.getName())?.parameter : undefined;
    return {
      ...(declaration === undefined ? {} : { typeDeclaration: declaration }),
      ...(provider === undefined ? {} : { providerDeclaration: provider }),
    };
  };

  /** How a receiver is the one a subscription pattern names, as the consumers ask it. */
  const subscribedOn = (receiver: TsNode, pattern: SubscriberPattern): ReceiverEvidence | undefined =>
    pattern.receiverPackages === undefined || pattern.channel !== undefined
      ? receiverEvidence(receiver, pattern)
      : receiverIsFrom(receiver, pattern)
        ? 'checked'
        : undefined;

  /**
   * The channels a value handed to a helper names, read at the calls behind
   * the route that hand it in: the helper's parameter becomes what each such
   * call passes, followed out as far as it is a parameter again.
   */
  const handedChannels = (reached: Reached, parameter: ParameterDeclaration, byId: ReadonlyMap<string, Reached>, depth: number): ChannelResolution[] => {
    if (depth >= HANDED_DEPTH || !ownParameter(reached.scope, parameter)) return [];
    const index = positionOf(parameter);
    const name = nameOfScope(reached.scope);
    const out: ChannelResolution[] = [];
    for (const caller of reached.callers) {
      const calls: CallExpression[] = [];
      if (caller.call !== undefined) calls.push(caller.call);
      else {
        forEachCall(caller.scope.body, (node) => {
          const call = node as unknown as CallExpression;
          if (lineOf(call) === caller.line && calledName(call) === name) calls.push(call);
        }, caller.scope.leaveOut);
      }
      for (const call of calls) {
        const argument = call.getArguments()[index];
        if (argument === undefined) continue;
        const resolution = resolveChannelName(argument, ctx.config);
        if (isResolved(resolution)) {
          out.push(resolution);
          continue;
        }
        const further = parameterBehind(argument);
        const outer = byId.get(caller.scope.id);
        if (further !== undefined && outer !== undefined) out.push(...handedChannels(outer, further, byId, depth + 1));
      }
    }
    return out;
  };

  /** Every channel the bodies behind a route subscribe to, and whether a subscription was seen whose channel was not read. */
  const subscriptionsIn = (bodies: readonly Reached[]): { relayed: Relayed[]; unread: number } => {
    const byId = new Map(bodies.map((reached) => [reached.scope.id, reached]));
    const relayed: Relayed[] = [];
    let unread = 0;
    for (const reached of bodies) {
      const { scope } = reached;
      forEachCall(scope.body, (node) => {
        const call = node as unknown as CallExpression;
        const callee = call.getExpression();
        if (!Node.isPropertyAccessExpression(callee)) return;
        for (const { spec, pattern } of subscribing) {
          if (!methodMatches(callee.getName(), pattern.method) || !conditionsHold(call, pattern.where)) continue;
          const evidence = subscribedOn(callee.getExpression(), pattern);
          if (evidence === undefined) continue;
          const line = lineOf(call);
          // Through an object's branch not read, as much as a receiver stated rather than checked.
          const confidence: Confidence = evidence === 'stated' || reached.weak ? 'heuristic' : 'static';
          const resolution = nameForKind(
            collapsed(readAddress(call, addressOf(pattern), undefined, contextOf(callee.getExpression(), scope.owner), ctx.config, call.getText().slice(0, 60))),
            spec.channelKind,
          );
          if (isResolved(resolution)) {
            for (const name of resolution.names) relayed.push({ name, spec, confidence, file: scope.file, line });
            return;
          }
          // A channel handed in by whoever calls the helper the call is written in.
          const argument = call.getArguments()[pattern.channelArg];
          const parameter = argument === undefined ? undefined : parameterBehind(argument);
          const handed = parameter === undefined ? [] : handedChannels(reached, parameter, byId, 0);
          const read = handed.map((each) => nameForKind(each, spec.channelKind)).filter(isResolved);
          if (read.length === 0) {
            unread += 1;
            return;
          }
          for (const resolved of read) {
            for (const name of resolved.names) relayed.push({ name, spec, confidence, file: scope.file, line });
          }
          return;
        }
      }, scope.leaveOut);
    }
    return { relayed, unread };
  };

  /** The channels a consumer already drawn on the route's own handler takes: an annotation, a listener written there. */
  const alreadyConsumed = (handlerId: string): { channel: string; edge: GraphEdge; consumer: GraphNode }[] => {
    const out: { channel: string; edge: GraphEdge; consumer: GraphNode }[] = [];
    for (const handles of handlesTo.get(handlerId) ?? []) {
      const consumer = ctx.builder.getNode(handles.from);
      if (consumer?.type !== 'consumer' || consumer.meta?.['relay'] !== undefined) continue;
      for (const edge of consumesTo.get(consumer.id) ?? []) out.push({ channel: edge.from, edge, consumer });
    }
    return out;
  };

  const channelNodeOf = (name: string, spec: BrokerSpec, file: string, line: number): GraphNode => {
    const id = makeChannelId(name);
    const existing = ctx.builder.getNode(id);
    const adapters = new Set([...((existing?.meta?.['adapters'] as string[] | undefined) ?? []), spec.name]);
    const node = ctx.builder.addNode({ id, type: 'channel', label: name, repo: ctx.repo, file, line, meta: { channelKind: spec.channelKind, adapters: [...adapters] } });
    node.meta = { ...node.meta, adapters: [...adapters] };
    return node;
  };

  /** The channel a per-scope object is the hub of: the streams it holds, written to through its stub (P361). */
  const hubChannelOf = (className: string, declaration: ClassDeclaration, binding: string | undefined): GraphNode => {
    const name = `${HUB_PREFIX}${className}`;
    return ctx.builder.addNode({
      id: makeChannelId(name),
      type: 'channel',
      label: name,
      repo: ctx.repo,
      file: ctx.fileOf(declaration),
      line: lineAndColumnAt(declaration.getSourceFile(), declaration.getStart()).line,
      meta: { channelKind: 'channel', adapters: [HUB_ADAPTER], heldBy: className, ...(binding === undefined ? {} : { binding }) },
    });
  };

  /** Handler bodies a route reads only part of: a plain worker's `fetch`, for the branch its path takes. */
  const routeViews = new Map<string, Scope>();

  /** A worker's own `fetch`, where the module's default export is an object holding one: `export default { fetch(request, env) {…} }`. */
  const defaultFetchOf = (source: SourceFile): NamedFunction | undefined => {
    for (const assignment of source.getExportAssignments()) {
      if (assignment.isExportEquals()) continue;
      let value: TsNode = assignment.getExpression();
      while (Node.isSatisfiesExpression(value) || Node.isAsExpression(value) || Node.isParenthesizedExpression(value)) value = value.getExpression();
      if (!Node.isObjectLiteralExpression(value)) continue;
      const property = value.getProperty('fetch');
      const line = property === undefined ? 0 : lineOf(property);
      if (property !== undefined && Node.isMethodDeclaration(property)) {
        const body = property.getBody();
        if (body !== undefined) return { name: 'default.fetch', declaration: property, body, line };
      }
      if (property !== undefined && Node.isPropertyAssignment(property)) {
        const fn = property.getInitializer();
        if (fn !== undefined && (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn))) return { name: 'default.fetch', declaration: property, body: fn.getBody(), line };
      }
    }
    return undefined;
  };

  /**
   * The routes of a plain worker that hand their request to a per-scope object
   * whose `fetch` streams server-sent events (P361). Nothing declares them as a
   * framework's routes do: the worker's `fetch` tells its paths apart itself
   * (`url.pathname === '/digest'`, `.startsWith('/feeds/')`, a pattern tested
   * against the path), so the branch that hands a request to such an object is
   * read as a `GET` route of that path - the one verb a browser's stream asks
   * with - answered by the worker's `fetch`, read for that branch alone. A
   * branch whose test names no path is a row.
   */
  const plainWorkerRoutes = (): GraphNode[] => {
    const out: GraphNode[] = [];
    for (const source of ctx.project.getSourceFiles()) {
      if (!isServiceSource(source.getFilePath(), ctx.repoDir)) continue;
      const fn = defaultFetchOf(source);
      if (fn === undefined) continue;
      const file = ctx.fileOf(source);
      let handler: Scope | undefined;
      forEachCall(fn.body, (node) => {
        const call = node as unknown as CallExpression;
        const stub = objects.stubCallOf(call);
        if (stub === undefined || stub.method !== 'fetch' || stub.target.kind !== 'class') return;
        const answered = methodBodyOf(stub.target.declaration, 'fetch');
        if (answered === undefined) return;
        const path = routePathOf(enclosingTests(call, fn.body));
        const requested = requestPathOf(call.getArguments()[0]);
        const asked = requested.kind === 'path' ? requested.path : path;
        if (shapeIn(answered.body, asked === undefined ? undefined : branchView(answered.body, asked).leaveOut) === undefined) return;
        const line = lineOf(call);
        const className = stub.target.className;
        if (path === undefined) {
          ctx.report({
            file,
            line,
            reason: 'route-path-dynamic',
            level: 'info',
            message: `This worker's fetch hands requests to the per-scope object ${className}, whose fetch streams server-sent events, under a test of the path that names no route, so no screen is joined to the stream.`,
            hint: "Test the path for equality, for a prefix (startsWith('/feeds/')), or with an anchored pattern, or serve the stream from a route of a router.",
            symbol: fn.name,
          });
          return;
        }
        if (handler === undefined) {
          const made = ctx.ensureFunctionNode(fn);
          handler = { id: made.id, file, body: fn.body, fn, ensure: () => undefined };
        }
        const normalized = normalizePath(path);
        const id = makeEntryId(ctx.repo, 'http', makeHttpEntryKey('GET', normalized));
        const route = ctx.builder.addNode({
          id,
          type: 'entry',
          kind: 'http',
          label: `GET ${normalized}`,
          repo: ctx.repo,
          file,
          line,
          meta: { method: 'GET', path: normalized, rawPath: path, adapter: 'worker-fetch', registration: 'pathname', handlerVia: 'object' },
        });
        const edge: GraphEdge = { from: id, to: handler.id, type: 'handles', confidence: 'static', file, line };
        ctx.builder.addEdge(edge);
        handlesFrom.set(id, [...(handlesFrom.get(id) ?? []), edge]);
        handlesTo.set(handler.id, [...(handlesTo.get(handler.id) ?? []), edge]);
        routeViews.set(id, viewOf(handler, branchView(fn.body, path).leaveOut));
        out.push(route);
      });
    }
    return out;
  };
  routes.push(...(objectsInPlay ? plainWorkerRoutes() : []));
  if (routes.length === 0) return;

  /** One route found to stream, and what was read behind it. */
  interface Streamed {
    readonly route: GraphNode;
    readonly handlerId: string;
    readonly relayed: readonly Relayed[];
    readonly unread: number;
    readonly consumed: ReturnType<typeof alreadyConsumed>;
    readonly hops: readonly Hop[];
    /** The object whose code answers with the stream and holds it open, where it is one. */
    readonly hub?: { readonly declaration: ClassDeclaration; readonly held: ReadonlySet<string>; readonly binding?: string; readonly weak: boolean };
  }

  const streamed: Streamed[] = [];
  for (const route of routes) {
    const handlers = (handlesFrom.get(route.id) ?? []).map((edge) => edge.to).filter((id) => ctx.builder.getNode(id)?.type !== 'consumer');
    const [handlerId] = handlers;
    if (handlerId === undefined) continue;
    const { bodies, hops } = behind(handlers, route);
    const shaped = bodies
      .filter((reached) => reached.shapeDepth <= SHAPE_DEPTH)
      .map((reached) => ({ reached, shape: shapeIn(reached.scope.body, reached.scope.leaveOut) }))
      .find((each) => each.shape !== undefined);
    const shape: StreamShape | undefined = declaredAsStream(route) ? 'decorator' : shaped?.shape;
    const missed = hops.filter((each) => !each.entered);
    if (shape === undefined) {
      // A route handed to an object whose class is not read: the stream, if
      // it is one, is answered there, and a browser holding it open is told why.
      if (missed.length > 0 && route.meta?.['method'] === 'GET') {
        route.meta = {
          ...route.meta,
          handedTo: missed.map((each) => ({
            ...(each.stub.origin.binding === undefined ? {} : { binding: each.stub.origin.binding }),
            method: each.stub.method,
            why: each.why,
            hint: each.hint,
            file: each.file,
            line: each.line,
          })),
        };
      }
      continue;
    }

    const entered = hops.filter((each) => each.entered && each.stub.target.kind === 'class');
    route.meta = {
      ...route.meta,
      stream: STREAM_KIND,
      streamFrom: shape,
      ...(entered.length === 0
        ? {}
        : {
            servedBy: [
              ...new Map(
                entered.map((each) => {
                  const target = each.stub.target as Extract<ObjectClass, { kind: 'class' }>;
                  const served = { class: target.className, ...(target.binding === undefined ? {} : { binding: target.binding }), method: each.stub.method, via: target.via };
                  return [JSON.stringify(served), served] as const;
                }),
              ).values(),
            ],
          }),
    };
    const { relayed, unread } = subscriptionsIn(bodies);
    const consumed = alreadyConsumed(handlerId);
    const object = shaped?.reached.object;
    let hub: Streamed['hub'];
    if (object !== undefined) {
      const own = bodies.filter((each) => each.object === object);
      const held = new Set(own.flatMap((each) => [...heldFieldsIn(each.scope.body, each.scope.leaveOut)]));
      const via = entered.find((each) => (each.stub.target as { declaration?: ClassDeclaration }).declaration === object);
      const binding = via?.stub.origin.binding;
      if (held.size > 0) hub = { declaration: object, held, ...(binding === undefined ? {} : { binding }), weak: own.every((each) => each.weak) };
    }
    streamed.push({ route, handlerId, relayed, unread, consumed, hops, ...(hub === undefined ? {} : { hub }) });
  }

  // The objects that hold streams open, and the calls on their stubs that write to them.
  const hubs = new Map<ClassDeclaration, { held: Set<string>; writers: Set<string>; binding?: string }>();
  for (const { hub } of streamed) {
    if (hub === undefined) continue;
    const known = hubs.get(hub.declaration);
    if (known !== undefined) {
      for (const field of hub.held) known.held.add(field);
      continue;
    }
    hubs.set(hub.declaration, { held: new Set(hub.held), writers: new Set(), ...(hub.binding === undefined ? {} : { binding: hub.binding }) });
  }
  const fed = new Map<ClassDeclaration, number>();
  if (hubs.size > 0) {
    for (const [declaration, hub] of hubs) {
      for (const method of methodsOfClass(declaration)) {
        const name = method.getName();
        if (PLATFORM_HOOK.test(name)) continue;
        const own = methodBodyOf(declaration, name);
        if (own !== undefined && feedsHeld(declaration, own.body, hub.held)) hub.writers.add(name);
      }
    }
    const writerNames = new Set([...hubs.values()].flatMap((hub) => [...hub.writers]));
    const routeOf = (scope: Scope): GraphNode | undefined =>
      (handlesTo.get(scope.id) ?? []).map((edge) => ctx.builder.getNode(edge.from)).find((node) => node?.type === 'entry');
    const seen = new Set<TsNode>();
    for (const scope of scopes.values()) {
      if (seen.has(scope.body)) continue;
      seen.add(scope.body);
      forEachCall(scope.body, (node) => {
        const call = node as unknown as CallExpression;
        const callee = call.getExpression();
        if (!Node.isPropertyAccessExpression(callee)) return;
        const method = callee.getName();
        if (method !== 'fetch' && !writerNames.has(method)) return;
        const stub = objects.stubCallOf(call);
        if (stub === undefined || stub.target.kind !== 'class') return;
        const { declaration } = stub.target;
        const hub = hubs.get(declaration);
        if (hub === undefined) return;
        let confidence: Confidence = 'static';
        if (method === 'fetch') {
          const answered = methodBodyOf(declaration, 'fetch');
          if (answered === undefined) return;
          const requested = requestPathOf(call.getArguments()[0]);
          const path = requested.kind === 'path' ? requested.path : requested.kind === 'forwarded' ? pathOfRoute(routeOf(scope)) : undefined;
          // A request whose path is not read could take any branch; it is not drawn as a write.
          if (path === undefined) return;
          const view = branchView(answered.body, path);
          if (shapeIn(answered.body, view.leaveOut) !== undefined) return;
          if (!feedsHeld(declaration, answered.body, hub.held, view.leaveOut)) return;
          if (!view.matched) confidence = 'heuristic';
        } else if (!hub.writers.has(method)) return;
        const className = declaration.getName() ?? 'default';
        const channel = hubChannelOf(className, declaration, hub.binding);
        const { line, column } = lineAndColumnAt(call.getSourceFile(), call.getStart());
        const producerId = makeLeafId('producer', ctx.repo, scope.file, line, column);
        const argument = method === 'fetch' ? undefined : call.getArguments()[0];
        const payload = argument === undefined ? undefined : ctx.types.collectType(argument.getType(), argument);
        scope.ensure();
        ctx.builder.addNode({
          id: producerId,
          type: 'producer',
          label: `event ${channel.label}`,
          repo: ctx.repo,
          file: scope.file,
          line,
          kind: 'event',
          meta: {
            kind: 'event',
            adapter: HUB_ADAPTER,
            channelVia: 'object',
            method,
            objectClass: className,
            ...(stub.origin.binding === undefined ? {} : { binding: stub.origin.binding }),
          },
        });
        ctx.builder.addEdge({ from: scope.id, to: producerId, type: 'calls', confidence, file: scope.file, line });
        ctx.builder.addEdge({ from: producerId, to: channel.id, type: 'emits', confidence, file: scope.file, line, ...(payload === undefined ? {} : { params: [payload] }) });
        fed.set(declaration, (fed.get(declaration) ?? 0) + 1);
      }, scope.leaveOut);
    }
  }

  for (const { route, handlerId, relayed, unread, consumed, hops, hub } of streamed) {
    // The object is the channel's hub where something writes to it through
    // its stub, or where nothing else feeds the streams it holds.
    const hubbed = hub !== undefined && ((fed.get(hub.declaration) ?? 0) > 0 || relayed.length === 0) ? hub : undefined;
    const file = route.file ?? '';
    const line = route.line ?? 0;
    if (relayed.length === 0 && consumed.length === 0 && hubbed === undefined) {
      const missed = hops.find((each) => !each.entered);
      const entered = hops.find((each) => each.entered && each.stub.target.kind === 'class');
      const className = entered === undefined ? undefined : (entered.stub.target as { className: string }).className;
      ctx.report({
        file,
        line,
        reason: 'stream-relay-unread',
        level: 'info',
        message:
          unread > 0
            ? 'This route streams server-sent events, and the code behind it subscribes to a channel whose name is not read.'
            : missed !== undefined
              ? `This route streams server-sent events and hands its request to a per-scope object whose class is not read: ${missed.why}.`
              : className !== undefined
                ? `This route streams server-sent events from the per-scope object ${className} its request is handed to, and no subscription to a channel was found in the object's code, nor a method of it the project calls that writes to the streams it holds.`
                : 'This route streams server-sent events, and no subscription to a channel was found in the code behind it.',
        hint:
          unread > 0
            ? 'Hand the subscription a channel the code states, or annotate the handler with @Consumes(\'<channel>\').'
            : missed !== undefined
              ? (missed.hint ?? 'Annotate the handler with @Consumes(\'<channel>\').')
              : 'What reaches the stream is decided by code not read as a subscription (a pipeline over a subject, a request handed to an object of its own). Annotate the handler with @Consumes(\'<channel>\').',
        symbol: route.label,
      });
      continue;
    }

    const handler = ctx.builder.getNode(handlerId);
    // A plain worker's `fetch` answers several routes, one branch each: a consumer per route.
    const shared = routeViews.has(route.id);
    const consumerId = shared ? `consumer:${handlerId}@${route.label}` : `consumer:${handlerId}`;
    const adapters = [
      ...new Set(
        [...relayed.map((each) => each.spec.name), ...(hubbed === undefined ? [] : [HUB_ADAPTER]), ...consumed.map((each) => String(each.consumer.meta?.['adapter'] ?? ''))].filter(
          (name) => name !== '',
        ),
      ),
    ].sort();
    ctx.builder.addNode({
      id: consumerId,
      type: 'consumer',
      label: shared || handler === undefined ? route.label : handler.label,
      repo: ctx.repo,
      file,
      line,
      kind: STREAM_KIND,
      meta: { kind: STREAM_KIND, ...(adapters[0] === undefined ? {} : { adapter: adapters[0] }), relay: route.id, entryId: null },
    });
    // Where a listener written in the handler was drawn as this same node, it
    // keeps what it was and is marked with the route it relays to.
    const node = ctx.builder.getNode(consumerId);
    if (node !== undefined) node.meta = { ...node.meta, relay: route.id };
    ctx.builder.addEdge({ from: consumerId, to: handlerId, type: 'handles', confidence: 'static', file, line });
    for (const each of relayed) {
      const channel = channelNodeOf(each.name, each.spec, each.file, each.line);
      ctx.builder.addEdge({ from: channel.id, to: consumerId, type: 'consumes', confidence: each.confidence, file: each.file, line: each.line });
    }
    const hubChannels: string[] = [];
    if (hubbed !== undefined) {
      const declaration = hubbed.declaration;
      const channel = hubChannelOf(declaration.getName() ?? 'default', declaration, hubbed.binding);
      const at = lineAndColumnAt(declaration.getSourceFile(), declaration.getStart()).line;
      ctx.builder.addEdge({
        from: channel.id,
        to: consumerId,
        type: 'consumes',
        confidence: hubbed.weak ? 'heuristic' : 'static',
        file: ctx.fileOf(declaration),
        line: at,
      });
      hubChannels.push(channel.id);
    }
    for (const each of consumed) {
      ctx.builder.addEdge({ from: each.channel, to: consumerId, type: 'consumes', confidence: each.edge.confidence, file: each.edge.file ?? file, line: each.edge.line ?? line });
    }
    route.meta = { ...route.meta, relays: [...new Set([...relayed.map((each) => makeChannelId(each.name)), ...hubChannels, ...consumed.map((each) => each.channel)])].sort() };
  }
};

export const streamRelaysPass: ExtractorPass<PassContext> = definePass('stream-relays', extractStreamRelays);
