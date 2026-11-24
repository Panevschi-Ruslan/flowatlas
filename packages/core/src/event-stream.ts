import type { CallExpression, NewExpression, Node as TsNode } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import type { GraphBuilder } from './builder.js';
import type { Confidence } from './model/edges.js';
import type { Unresolved } from './model/graph.js';
import { isPlatformProvided } from './platform-fetch.js';
import type { SubjectRelay } from './stream-subjects.js';

/**
 * A browser's stream of server-sent events, read the same way by every reader
 * of a screen (P359).
 *
 * A stream is a request like any other - one `GET`, held open - and each
 * front-end reader records it as one, joined to the route that serves it. What
 * this module adds is the other half: the function the frames arrive at. The
 * route forwards a channel onto the stream, and the screen's message handler is
 * where that channel's messages end up, so the handler is linked as a consumer
 * the way a backend handler is: a `consumer` node that `handles` the function,
 * reached from the request by `triggers`. The linker then joins the channels
 * the route relays to that consumer (`consumes`), and channel, route and screen
 * are one walk.
 *
 * Only where the handler is: what it does with a frame - which kinds of
 * message it selects - is read off the function it `handles`, by whatever reads
 * that of any consumer.
 */

/** The browser's own client for a stream of server-sent events. */
export const EVENT_SOURCE = 'EventSource';

/** The kind a stream's request, and the consumer its frames arrive at, are recorded with. */
export const STREAM_KIND = 'sse';

/** The events a stream raises about itself rather than about anything it carries. */
const OWN_EVENTS: ReadonlySet<string> = new Set(['open', 'error']);

/** Where frames are handed to: the property, and the method that registers a listener. */
const ON_MESSAGE = 'onmessage';
const ADD_LISTENER = 'addEventListener';

/**
 * Whether a construction is of the browser's `EventSource`.
 *
 * The name alone proves nothing - a repository is free to declare a class of
 * its own by that name. What decides is where the name was declared: the
 * language's own library, or a package standing in for it. A name the checker
 * will not resolve at all is accepted, because it is then the ambient global in
 * a repository whose compiler settings leave the browser's library out.
 */
export const isEventSourceConstruction = (node: TsNode): node is NewExpression => {
  if (!Node.isNewExpression(node)) return false;
  const expression = node.getExpression();
  return Node.isIdentifier(expression) && expression.getText() === EVENT_SOURCE && isPlatformProvided(expression);
};

/** One function registered on a stream for its frames. */
export interface StreamListener {
  /** The registration: `source.onmessage = …`, `source.addEventListener(…)`. */
  readonly site: TsNode;
  /** The event listened for: `message` for `onmessage`, the name written otherwise; `null` where not read. */
  readonly event: string | null;
  /** The function registered, as written. */
  readonly handler: TsNode;
}

/** What is done with a stream where it is made. */
export interface StreamHolding {
  /** The functions registered on it for its frames, where it is held. */
  readonly listeners: readonly StreamListener[];
  /** Whether it is handed back to the caller, who holds it instead. */
  readonly returned: boolean;
}

/** A value with the parentheses, casts and `!` around it taken off. */
const bare = (node: TsNode): TsNode => {
  let at = node;
  for (;;) {
    if (Node.isParenthesizedExpression(at) || Node.isAsExpression(at) || Node.isNonNullExpression(at) || Node.isSatisfiesExpression(at)) {
      at = at.getExpression();
      continue;
    }
    return at;
  }
};

/** The expression a value is part of, past the wrappers that change nothing. */
const consumerOf = (value: TsNode): { node: TsNode; parent: TsNode | undefined } => {
  let node = value;
  let parent = node.getParent();
  while (
    parent !== undefined &&
    (Node.isParenthesizedExpression(parent) || Node.isAsExpression(parent) || Node.isNonNullExpression(parent) || Node.isSatisfiesExpression(parent) || Node.isAwaitExpression(parent))
  ) {
    node = parent;
    parent = parent.getParent();
  }
  return { node, parent };
};

/** The body a name declared at `node` is visible in: the function around it, or its file. */
const scopeAround = (node: TsNode): TsNode =>
  node.getFirstAncestor((at) => Node.isFunctionLikeDeclaration(at) || Node.isArrowFunction(at) || Node.isFunctionExpression(at)) ?? node.getSourceFile();

/** A receiver written the way a holder is compared: `this.source?.x` and `this.source!.x` are `this.source`. */
const spelled = (node: TsNode): string => bare(node).getText().replace(/\?\./g, '.').replace(/!/g, '');

/**
 * How a stream is held where it is made, as a test of a receiver.
 *
 * A name it is bound to (`const source = new EventSource(url)`), compared by
 * declaration so a name shadowed in an inner function is not it; or a place it
 * is written to (`this.source = …`, `ref.current = …`), compared by spelling
 * across the class (for `this.`) or the function it is written in.
 */
const holderOf = (value: TsNode): { scope: TsNode; holds: (receiver: TsNode) => boolean } | 'returned' | undefined => {
  const { node, parent } = consumerOf(value);
  if (parent === undefined) return undefined;
  if (Node.isVariableDeclaration(parent) && parent.getInitializer() === node) {
    const name = parent.getNameNode();
    if (!Node.isIdentifier(name)) return undefined;
    const declared = name.getSymbol();
    return {
      scope: scopeAround(parent),
      holds: (receiver) => {
        const at = bare(receiver);
        return Node.isIdentifier(at) && at.getText() === name.getText() && (declared === undefined || at.getSymbol() === declared);
      },
    };
  }
  if (Node.isBinaryExpression(parent) && parent.getOperatorToken().getKind() === SyntaxKind.EqualsToken && parent.getRight() === node) {
    const left = bare(parent.getLeft());
    if (Node.isIdentifier(left)) {
      const declared = left.getSymbol();
      const declaration = declared?.getDeclarations()[0];
      return {
        scope: declaration === undefined ? scopeAround(parent) : scopeAround(declaration),
        holds: (receiver) => {
          const at = bare(receiver);
          return Node.isIdentifier(at) && at.getText() === left.getText() && (declared === undefined || at.getSymbol() === declared);
        },
      };
    }
    if (!Node.isPropertyAccessExpression(left) && !Node.isElementAccessExpression(left)) return undefined;
    const key = spelled(left);
    const onThis = Node.isThisExpression(bare(left.getExpression()));
    const scope = onThis
      ? (parent.getFirstAncestor((at) => Node.isClassDeclaration(at) || Node.isClassExpression(at)) ?? scopeAround(parent))
      : scopeAround(parent);
    return { scope, holds: (receiver) => spelled(receiver) === key };
  }
  if (Node.isReturnStatement(parent) || (Node.isArrowFunction(parent) && parent.getBody() === node)) return 'returned';
  return undefined;
};

/** The name an event is registered under, where it is written as one. */
const eventNameOf = (argument: TsNode | undefined): string | null => {
  if (argument === undefined) return null;
  const at = bare(argument);
  return Node.isStringLiteral(at) || Node.isNoSubstitutionTemplateLiteral(at) ? at.getLiteralText() : null;
};

/**
 * The functions a stream's frames are handed to, read where the stream is held.
 *
 * `value` is the construction, or a call that hands one back. Registrations are
 * `holder.onmessage = fn` and `holder.addEventListener(name, fn)`, wherever in
 * the holder's scope they are written; the stream's own `open` and `error` are
 * not frames and are left out.
 */
export const streamHoldingOf = (value: TsNode): StreamHolding => {
  const holder = holderOf(value);
  if (holder === undefined) return { listeners: [], returned: false };
  if (holder === 'returned') return { listeners: [], returned: true };
  const listeners: StreamListener[] = [];
  holder.scope.forEachDescendant((node) => {
    if (Node.isBinaryExpression(node) && node.getOperatorToken().getKind() === SyntaxKind.EqualsToken) {
      const left = bare(node.getLeft());
      if (Node.isPropertyAccessExpression(left) && left.getName() === ON_MESSAGE && holder.holds(left.getExpression())) {
        listeners.push({ site: node, event: 'message', handler: node.getRight() });
      }
      return;
    }
    if (!Node.isCallExpression(node)) return;
    const callee = node.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== ADD_LISTENER || !holder.holds(callee.getExpression())) return;
    const [name, handler] = node.getArguments();
    if (handler === undefined) return;
    const event = eventNameOf(name);
    if (event !== null && OWN_EVENTS.has(event)) return;
    listeners.push({ site: node, event, handler });
  });
  return { listeners, returned: false };
};

/** A function registered as a handler, as written: an arrow or a function expression. */
export const isWrittenFunction = (node: TsNode): boolean => {
  const at = bare(node);
  return Node.isArrowFunction(at) || Node.isFunctionExpression(at);
};

/**
 * The one thing a handler written in place does, when it does only one thing:
 * call a name (`(m) => onEvent(m)`, `function (m) { handle(JSON.parse(m.data)) }`).
 * The callee is what a reader follows; a handler that does more is its own step.
 */
export const delegateOf = (handler: TsNode): TsNode | undefined => {
  const at = bare(handler);
  if (!Node.isArrowFunction(at) && !Node.isFunctionExpression(at)) return undefined;
  const body = at.getBody();
  let only: TsNode | undefined = body;
  if (Node.isBlock(body)) {
    const statements = body.getStatements();
    if (statements.length !== 1) return undefined;
    const [statement] = statements;
    only = Node.isExpressionStatement(statement) || Node.isReturnStatement(statement) ? statement.getExpression() : undefined;
  }
  if (only === undefined) return undefined;
  const call = bare(only);
  if (!Node.isCallExpression(call)) return undefined;
  const callee = bare(call.getExpression());
  return Node.isIdentifier(callee) || Node.isPropertyAccessExpression(callee) ? callee : undefined;
};

/** What a screen's consumer of a stream is recorded from. */
export interface StreamConsumer {
  readonly repo: string;
  /** The `ui_api_call` node of the stream's request. */
  readonly callId: string;
  /** The node of the function the frames arrive at. */
  readonly handlerId: string;
  readonly label: string;
  /** Where the handler is registered. */
  readonly file: string;
  readonly line: number;
  /** The events it is registered for, `null` where a name was not read. */
  readonly events: readonly (string | null)[];
  readonly confidence: Confidence;
  /** Where the function subscribes to a subject the stream's frames are pushed into, rather than holding the stream (P362). */
  readonly subscription?: StreamSubscription;
  /** Why it never runs, where that is known: the service it subscribes through is made by nothing. */
  readonly unreached?: string;
}

/** A subscription a screen makes to what a stream's frames are pushed into (P362), where it is written. */
export interface StreamSubscription {
  /** The `subscribe` call's line and column, in the consumer's file. */
  readonly line: number;
  readonly column: number;
  /** What it subscribes to, as `Holder.member`. */
  readonly through: string;
}

/** On a stream's consumer: the subscriptions it makes to what the frames are pushed into, each read for the types it chooses. */
export const SUBSCRIPTIONS_META = 'subscriptions';
/** On a consumer: why it never runs. */
export const UNREACHED_META = 'unreached';
/** On the consumer a stream's frames arrive at, where it only pushes them into a subject: the consumers subscribed to it. */
export const HANDS_ON_META = 'handsOnTo';

/** The subscriptions a consumer records, as written. */
export const subscriptionsOf = (node: { meta?: Record<string, unknown> } | undefined): StreamSubscription[] => {
  const raw = node?.meta?.[SUBSCRIPTIONS_META];
  return Array.isArray(raw)
    ? raw.filter((each): each is StreamSubscription => typeof each === 'object' && each !== null && typeof (each as StreamSubscription).line === 'number' && typeof (each as StreamSubscription).column === 'number')
    : [];
};

/** The id of the consumer a stream's frames arrive at in one function. */
export const streamConsumerId = (handlerId: string): string => `consumer:${handlerId}`;

/**
 * Records the function a stream's frames arrive at as a consumer.
 *
 * One consumer per function, as a backend handler has: two streams handled by
 * the same function are one consumer reached from two requests. It answers no
 * way in of its own (`entryId: null`), and nothing names a channel here: the
 * channels arrive from the route, which only the linker can see.
 */
export const recordStreamConsumer = (builder: GraphBuilder, consumer: StreamConsumer): string => {
  const id = streamConsumerId(consumer.handlerId);
  const events = [...new Set(consumer.events.map((event) => event ?? '?'))].sort();
  builder.addNode({
    id,
    type: 'consumer',
    label: consumer.label,
    repo: consumer.repo,
    file: consumer.file,
    line: consumer.line,
    kind: STREAM_KIND,
    meta: { kind: STREAM_KIND, client: EVENT_SOURCE, events, entryId: null },
  });
  const node = builder.getNode(id);
  if (node !== undefined && consumer.subscription !== undefined) {
    const known = subscriptionsOf(node);
    const at = consumer.subscription;
    if (!known.some((each) => each.line === at.line && each.column === at.column)) {
      node.meta = { ...node.meta, [SUBSCRIPTIONS_META]: [...known, at].sort((a, b) => a.line - b.line || a.column - b.column) };
    }
  }
  if (node !== undefined && consumer.unreached !== undefined) node.meta = { ...node.meta, [UNREACHED_META]: consumer.unreached };
  builder.addEdge({ from: id, to: consumer.handlerId, type: 'handles', confidence: 'static', file: consumer.file, line: consumer.line });
  builder.addEdge({ from: consumer.callId, to: id, type: 'triggers', confidence: consumer.confidence, file: consumer.file, line: consumer.line });
  return id;
};

/** The row for a stream nobody was seen listening to, or whose listener could not be followed. */
export const streamHandlerUnreadRow = (file: string, line: number, symbol: string, why: 'none' | 'unread'): Unresolved => ({
  file,
  line,
  reason: 'stream-handler-unread',
  level: 'info',
  message:
    why === 'none'
      ? 'A stream of server-sent events is opened here and no handler for its frames is registered where it is held.'
      : 'A handler is registered for the frames of this stream, and which function it is could not be followed.',
  hint:
    why === 'none'
      ? 'Register the handler with onmessage or addEventListener on the value the stream is held in, in the function or class that opens it.'
      : 'Register a function declared by name, or one written in place that calls one.',
  symbol: symbol.slice(0, 80),
});

/** What a reader of a screen hands in to record the subscriptions behind a stream's consumer. */
export interface SubjectSubscribers {
  readonly repo: string;
  /** The `ui_api_call` nodes of the stream's request, each with the call it is recorded at, where the reader has it. */
  readonly calls: readonly { readonly id: string; readonly site?: TsNode }[];
  /** The consumer the stream's frames arrive at, which pushes them into the subject. */
  readonly consumerId: string;
  /** The function a `subscribe` is written in, as the reader draws it: its node's id and label; `undefined` where it draws none. */
  handlerOf(subscribe: CallExpression): { readonly id: string; readonly label: string } | undefined;
  fileOf(node: TsNode): string;
}

/**
 * Records every subscription behind a stream's consumer as a consumer of the
 * stream of its own (P362): the function the `subscribe` is written in, reached
 * from the stream's request as the consumer is, carrying where it subscribes so
 * the types it chooses - in the operators before it and in its callback - are
 * read there. The consumer that only pushes the frames on says which consumers
 * it hands them to. A subscription in a function the reader draws no node for,
 * and a subject nothing is read subscribing to, are rows.
 */
export const recordSubjectSubscribers = (builder: GraphBuilder, relay: SubjectRelay, at: SubjectSubscribers, report: (row: Unresolved) => void): string[] => {
  const recorded: string[] = [];
  for (const subscription of relay.subscriptions) {
    const { subscribe } = subscription;
    const file = at.fileOf(subscribe);
    const start = subscribe.getSourceFile().getLineAndColumnAtPos(subscribe.getStart());
    const handler = at.handlerOf(subscribe);
    if (handler === undefined) {
      report(streamHandlerUnreadRow(file, start.line, subscription.through, 'unread'));
      continue;
    }
    // One instance of a generic stream class is fed by the requests its wrapper makes (P362).
    const entry = subscription.entry;
    const own = entry === undefined ? [] : at.calls.filter((call) => call.site !== undefined && call.site.getSourceFile() === entry.getSourceFile() && entry.containsRange(call.site.getPos(), call.site.getEnd()));
    for (const { id: callId } of own.length > 0 ? own : at.calls) {
      recorded.push(
        recordStreamConsumer(builder, {
          repo: at.repo,
          callId,
          handlerId: handler.id,
          label: handler.label,
          file,
          line: start.line,
          events: ['message'],
          confidence: 'static',
          subscription: { line: start.line, column: start.column, through: subscription.through },
          ...(subscription.unreached === undefined ? {} : { unreached: subscription.unreached }),
        }),
      );
    }
  }
  const consumer = builder.getNode(at.consumerId);
  const handsOn = [...new Set(recorded)].filter((id) => id !== at.consumerId).sort();
  if (consumer !== undefined) {
    consumer.meta = {
      ...consumer.meta,
      ...(handsOn.length === 0 ? {} : { [HANDS_ON_META]: handsOn }),
      subjects: [...relay.subjects],
      ...(relay.unreached === undefined ? {} : { [UNREACHED_META]: relay.unreached }),
    };
  }
  if (relay.subscriptions.length === 0 && consumer !== undefined) {
    report({
      file: consumer.file ?? '',
      line: consumer.line ?? 0,
      reason: 'stream-handler-unread',
      level: 'info',
      message: `The frames of this stream are pushed into ${relay.subjects.join(', ')}, and nothing in this repository was read subscribing to it.`,
      hint: 'Subscribe through the service that holds the subject (a field it exposes, a getter, or the subject itself), with .subscribe(…) after any .pipe(…).',
      symbol: consumer.label.slice(0, 80),
    });
  }
  return handsOn;
};

/** On a route answering with a stream: the names of the events its frames are written under, `message` for a frame named none (P388). */
export const STREAM_EVENTS_META = 'streamEvents';
/** On such a route: some frame's name was not read, so `streamEvents` may not be all of them (P388). */
export const STREAM_EVENTS_UNREAD_META = 'streamEventsUnread';
