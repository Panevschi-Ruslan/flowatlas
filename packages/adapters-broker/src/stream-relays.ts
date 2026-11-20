import {
  conditionsHold,
  definePass,
  forEachCall,
  lineAndColumnAt,
  makeChannelId,
  resolveTypeOrigin,
  STREAM_KIND,
  type Confidence,
  type ExtractorPass,
  type GraphEdge,
  type GraphNode,
  type LocatorContext,
} from '@flowatlas/core';
import { scopesOf, type PassContext, type Scope } from '@flowatlas/extract-scopes';
import type { CallExpression, ClassDeclaration, Node as TsNode, ParameterDeclaration } from 'ts-morph';
import { Node } from 'ts-morph';
import type { BrokerSpec, SubscriberPattern } from './adapters/index.js';
import { addressOf, collapsed, readAddress } from './address.js';
import { brokerSpecsFor } from './brokers-pass.js';
import { methodMatches, receiverEvidence, receiverIsFrom, type ReceiverEvidence } from './call-site.js';
import { isResolved, nameForKind, resolveChannelName, type ChannelResolution } from './channel-name.js';

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
 * A stream with no subscription found behind it - an rxjs pipeline over a
 * subject, a request handed to an object of its own, a channel in a value not
 * read - is a row on the route, never silence.
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
  readonly callers: readonly Caller[];
}

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
const shapeIn = (body: TsNode): StreamShape | undefined => {
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
  if (routes.length === 0) return;
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

  /** The bodies behind a route, breadth first from its handler. */
  const behind = (handlers: readonly string[]): Reached[] => {
    const reached = new Map<string, { scope: Scope; depth: number; callers: Caller[] }>();
    let frontier = handlers.flatMap((id) => {
      const scope = scopes.get(id);
      return scope === undefined ? [] : [scope];
    });
    for (const scope of frontier) reached.set(scope.id, { scope, depth: 0, callers: [] });
    for (let depth = 1; depth <= STREAM_DEPTH && frontier.length > 0 && reached.size < MOST_BODIES; depth += 1) {
      const next: Scope[] = [];
      const reach = (scope: Scope, caller: Caller): void => {
        const known = reached.get(scope.id);
        if (known !== undefined) {
          if (!known.callers.some((each) => each.scope === caller.scope && each.line === caller.line)) known.callers.push(caller);
          return;
        }
        if (reached.size >= MOST_BODIES) return;
        reached.set(scope.id, { scope, depth, callers: [caller] });
        next.push(scope);
      };
      for (const from of frontier) {
        forEachCall(from.body, (node) => {
          const call = node as unknown as CallExpression;
          const scope = calleeScope(call);
          if (scope !== undefined && scope !== from) reach(scope, { scope: from, line: lineOf(call), call });
        }, from.leaveOut);
        // A call the checker leaves open and the injection reading settled.
        for (const edge of callsFrom.get(from.id) ?? []) {
          const scope = scopes.get(edge.to);
          if (scope !== undefined && scope !== from) reach(scope, { scope: from, line: edge.line ?? 0 });
        }
      }
      frontier = next;
    }
    return [...reached.values()];
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
          const confidence: Confidence = evidence === 'stated' ? 'heuristic' : 'static';
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

  for (const route of routes) {
    const handlers = (handlesFrom.get(route.id) ?? []).map((edge) => edge.to).filter((id) => ctx.builder.getNode(id)?.type !== 'consumer');
    const [handlerId] = handlers;
    if (handlerId === undefined) continue;
    const bodies = behind(handlers);
    const shape: StreamShape | undefined = declaredAsStream(route)
      ? 'decorator'
      : bodies.filter((reached) => reached.depth <= SHAPE_DEPTH).map((reached) => shapeIn(reached.scope.body)).find((found) => found !== undefined);
    if (shape === undefined) continue;

    route.meta = { ...route.meta, stream: STREAM_KIND, streamFrom: shape };
    const { relayed, unread } = subscriptionsIn(bodies);
    const consumed = alreadyConsumed(handlerId);
    const file = route.file ?? '';
    const line = route.line ?? 0;
    if (relayed.length === 0 && consumed.length === 0) {
      ctx.report({
        file,
        line,
        reason: 'stream-relay-unread',
        level: 'info',
        message:
          unread > 0
            ? 'This route streams server-sent events, and the code behind it subscribes to a channel whose name is not read.'
            : 'This route streams server-sent events, and no subscription to a channel was found in the code behind it.',
        hint:
          unread > 0
            ? 'Hand the subscription a channel the code states, or annotate the handler with @Consumes(\'<channel>\').'
            : 'What reaches the stream is decided by code not read as a subscription (a pipeline over a subject, a request handed to an object of its own). Annotate the handler with @Consumes(\'<channel>\').',
        symbol: route.label,
      });
      continue;
    }

    const handler = ctx.builder.getNode(handlerId);
    const consumerId = `consumer:${handlerId}`;
    const adapters = [...new Set([...relayed.map((each) => each.spec.name), ...consumed.map((each) => String(each.consumer.meta?.['adapter'] ?? ''))].filter((name) => name !== ''))].sort();
    ctx.builder.addNode({
      id: consumerId,
      type: 'consumer',
      label: handler?.label ?? route.label,
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
    for (const each of consumed) {
      ctx.builder.addEdge({ from: each.channel, to: consumerId, type: 'consumes', confidence: each.edge.confidence, file: each.edge.file ?? file, line: each.edge.line ?? line });
    }
    route.meta = { ...route.meta, relays: [...new Set([...relayed.map((each) => makeChannelId(each.name)), ...consumed.map((each) => each.channel)])].sort() };
  }
};

export const streamRelaysPass: ExtractorPass<PassContext> = definePass('stream-relays', extractStreamRelays);
