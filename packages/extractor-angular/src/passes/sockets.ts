import {
  evaluateExpression,
  forEachCall,
  makeChannelId,
  makeLeafId,
  makeSymbolId,
  methodBodies,
  type ClassMethod,
  type GraphNode,
} from '@flowatlas/core';
import {
  hasAcknowledgement,
  isResolved,
  receiverIsFrom,
  resolveChannelName,
  shapeChannelNames,
  socketio,
  targetOfHandler,
  trimEndpoint,
  type ChannelResolution,
} from '@flowatlas/adapters-broker';
import type { CallExpression, ClassDeclaration, Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import type { AngularExtractContext } from '../context.js';
import { definePass } from './types.js';

/**
 * The browser's half of a socket.
 *
 * This is where the tool's own shape shows up in its own output: an event name
 * written in a browser and the same name written in a gateway are two ends of
 * one channel, and nothing but a graph joins them. So this pass reads the very
 * same description the service half reads — `socketio` — and resolves names
 * with the very same function. Two readers, one transport, one node.
 *
 * It is worth being explicit about why this is a channel at all, because the
 * neighbouring `sse` pass decided the opposite question the opposite way (R08).
 * A browser holding a stream of server-sent events open is not a consumer: it
 * opens an address and waits, and it never says what it is waiting for — the
 * channel lives inside the service, and what the service forwards onto the
 * stream is the service's business. A socket is the other case. The browser
 * writes `order:updated` itself, in its own source, and a gateway in another
 * repository writes the same string; neither of them is addressing the other,
 * they are both addressing the name. That is a channel with two repositories,
 * and reading it as a request to an address would throw away the only thing
 * either end actually stated.
 */

/** The transport's own description, read from the side that has no decorators. */
const SPEC = socketio;

/** A hole in a template, written as something no URL may contain. */
const HOLE = '\u0000';

/**
 * Where the path starts: after a scheme and host, or after a hole standing for one.
 *
 * The second half is the case that matters. Almost every browser writes the
 * origin as a settings key and the namespace beside it, so the address reads as
 * a hole followed by a path, and the path is written out even though the whole
 * string is not. A hole only counts as the origin when a slash follows it in the
 * source — `${base}/orders` says where the path begins, while `${base}` alone
 * could be an origin or an origin and a namespace, and guessing which is exactly
 * what must not happen here.
 */
const ORIGIN = /^(?:[a-z][a-z0-9+.-]*:\/\/[^/]*|\u0000[^/]*(?=\/))/i;

/**
 * The path part of an address, with the origin, the query and the slashes gone.
 *
 * A socket's namespace is the path it was opened on, so `http://host:3000/orders`,
 * `/orders` and `orders` all name the namespace a gateway declares as `orders`.
 */
const namespaceIn = (address: string): string => {
  const withoutOrigin = address.replace(ORIGIN, '');
  const query = withoutOrigin.search(/[?#]/);
  return trimEndpoint(query === -1 ? withoutOrigin : withoutOrigin.slice(0, query));
};

/** A template with its holes marked, so a reader can see whether a hole is in the path. */
const skeletonOf = (template: TsNode): string => {
  if (!Node.isTemplateExpression(template)) return HOLE;
  return (
    template.getHead().getLiteralText() +
    template
      .getTemplateSpans()
      .map((span) => HOLE + span.getLiteral().getLiteralText())
      .join('')
  );
};

/** The namespace an address names, or the text of the address that hid it. */
type Namespace = { readonly namespace: string } | { readonly unreadable: string };

/**
 * Which namespace a socket was opened on.
 *
 * The address is usually a settings key and a path written beside it —
 * `` io(`${environment.apiUrl}/orders`) `` — so the whole string rarely reads as
 * a constant while the part that matters always does. What is asked, then, is
 * narrower than "what is this address": it is whether the *path* is written out.
 * A hole anywhere in the path means the namespace is not stated, and defaulting
 * to the root namespace there would put a namespaced browser's events on the
 * nodes the unnamespaced ones use — a join between two ends that never meet.
 */
const namespaceOf = (address: TsNode | undefined): Namespace => {
  // `io()` with no address is the root namespace, said by saying nothing.
  if (address === undefined) return { namespace: '' };
  const value = evaluateExpression(address);
  if (value.resolved && typeof value.value === 'string') {
    return { namespace: namespaceIn(value.value) };
  }
  const path = namespaceIn(skeletonOf(address));
  if (path.includes(HOLE)) return { unreadable: address.getText().slice(0, 60) };
  return { namespace: path };
};

/**
 * The call that produced a socket.
 *
 * Not "the call to `io`": what makes a value a socket is its type, which the
 * pattern has already checked, so whatever call the value was initialised from
 * is the call that opened it whatever the client library happens to call its
 * factory. A field assigned in a constructor is looked for too, since a socket
 * kept as a field and opened later is as ordinary as one opened in place.
 */
const openedBy = (receiver: TsNode, owner: ClassDeclaration): CallExpression | undefined => {
  if (Node.isCallExpression(receiver)) return receiver;

  const asCall = (node: TsNode | undefined): CallExpression | undefined =>
    node !== undefined && Node.isCallExpression(node) ? node : undefined;

  const memberName =
    Node.isPropertyAccessExpression(receiver) && Node.isThisExpression(receiver.getExpression())
      ? receiver.getName()
      : undefined;
  if (memberName !== undefined) {
    const property = owner.getProperty(memberName);
    const initialised = asCall(property?.getInitializer());
    if (initialised !== undefined) return initialised;
    let assigned: CallExpression | undefined;
    owner.forEachDescendant((node) => {
      if (assigned !== undefined) return;
      if (!Node.isBinaryExpression(node)) return;
      if (node.getOperatorToken().getText() !== '=') return;
      const left = node.getLeft();
      if (!Node.isPropertyAccessExpression(left)) return;
      if (!Node.isThisExpression(left.getExpression()) || left.getName() !== memberName) return;
      assigned = asCall(node.getRight());
    });
    return assigned;
  }

  if (!Node.isIdentifier(receiver)) return undefined;
  const declaration = receiver.getSymbol()?.getDeclarations()[0];
  if (declaration === undefined || !Node.isVariableDeclaration(declaration)) return undefined;
  return asCall(declaration.getInitializer());
};

export const socketsPass = definePass('sockets', (ctx: AngularExtractContext) => {
  // The browser only ever holds a socket if the repository installed a client
  // for one, which is the same question the service half asks of its own
  // manifest and the same answer the same description gives.
  if (!SPEC.detect(ctx.pkg)) return;

  const channelNodeOf = (name: string, file: string, line: number): GraphNode => {
    const id = makeChannelId(name);
    const existing = ctx.builder.getNode(id);
    const adapters = new Set([
      ...((existing?.meta?.['adapters'] as string[] | undefined) ?? []),
      SPEC.name,
    ]);
    const node = ctx.builder.addNode({
      id,
      type: 'channel',
      label: name,
      repo: ctx.repo,
      file,
      line,
      meta: { channelKind: SPEC.channelKind, adapters: [...adapters] },
    });
    node.meta = { ...node.meta, adapters: [...adapters] };
    return node;
  };

  const reportChannel = (
    resolution: ChannelResolution,
    file: string,
    line: number,
    symbol: string,
  ): void => {
    if (isResolved(resolution)) return;
    ctx.report({
      file,
      line,
      reason: resolution.unresolved,
      hint: `The event name cannot be read here, so this end of the channel cannot be joined to the service that writes the other end. Annotate ${symbol} with the channel it uses.`,
      symbol: `${symbol} -> ${resolution.text.slice(0, 60)}`,
    });
  };

  const reportNamespace = (
    unreadable: string,
    file: string,
    line: number,
    symbol: string,
  ): void => {
    ctx.report({
      file,
      line,
      reason: 'channel-dynamic',
      hint: 'The address this socket was opened on cannot be read, so neither can the namespace its events belong to. Write the path beside the settings key rather than inside it.',
      symbol: `${symbol} -> ${unreadable}`,
    });
  };

  /**
   * The channels one call reaches: the names it writes, under the namespace the
   * socket was opened on, minus anything the library keeps for itself.
   */
  const channelsOf = (
    resolution: ChannelResolution,
    namespace: Namespace,
  ): string[] =>
    isResolved(resolution) && 'namespace' in namespace
      ? shapeChannelNames(resolution.names, {
          prefix: namespace.namespace,
          separator: SPEC.channelPrefix?.separator ?? '/',
          ...(SPEC.reservedChannels === undefined ? {} : { reserved: SPEC.reservedChannels }),
        })
      : [];

  const lineColOf = (node: TsNode): { line: number; column: number } =>
    node.getSourceFile().getLineAndColumnAtPos(node.getStart());

  const emitProducer = (
    call: CallExpression,
    receiver: TsNode,
    pattern: { method: string; channelArg: number; payloadArg?: number; kind?: string },
    owner: ClassDeclaration,
    methodId: string,
    file: string,
    symbol: string,
  ): void => {
    const args = call.getArguments();
    const { line, column } = lineColOf(call);

    const channelArg = args[pattern.channelArg];
    const resolution: ChannelResolution =
      channelArg === undefined
        ? { unresolved: 'channel-dynamic', text: call.getText().slice(0, 60) }
        : resolveChannelName(channelArg, ctx.config);
    const namespace = namespaceOf(openedBy(receiver, owner)?.getArguments()[0]);
    const names = channelsOf(resolution, namespace);
    // Everything this call names belongs to the library, not the application.
    if (isResolved(resolution) && 'namespace' in namespace && names.length === 0) return;

    // A publish that hands over a callback is a request waiting for a reply, and
    // the graph should not call the two the same thing. The reply itself needs
    // no edge of its own: the callback's body is part of the method that wrote
    // it, so whatever it delegates to is already on the chain and `flow` walks
    // straight into it.
    const kind =
      SPEC.acknowledgedKind !== undefined && hasAcknowledgement(args)
        ? SPEC.acknowledgedKind
        : (pattern.kind ?? 'event');

    const payloadArg = pattern.payloadArg === undefined ? undefined : args[pattern.payloadArg];
    // A socket's `emit` is typed as `(event: string, ...args: any[])`, so the
    // declaration promises nothing and the argument is all there is to read.
    const payloadType =
      payloadArg === undefined ? undefined : ctx.types.collectType(payloadArg.getType(), payloadArg);

    const producerId = makeLeafId('producer', ctx.repo, file, line, column);
    ctx.builder.addNode({
      id: producerId,
      type: 'producer',
      label: `${kind} ${names.length > 0 ? names.join(', ') : '?'}`,
      repo: ctx.repo,
      file,
      line,
      kind,
      meta: {
        kind,
        adapter: SPEC.name,
        channelVia: isResolved(resolution) ? resolution.via : 'unresolved',
        method: pattern.method,
      },
    });
    ctx.builder.addEdge({
      from: methodId,
      to: producerId,
      type: 'calls',
      confidence: names.length === 0 ? 'heuristic' : 'static',
      file,
      line,
    });

    if (names.length === 0) {
      if ('unreadable' in namespace) reportNamespace(namespace.unreadable, file, line, symbol);
      else reportChannel(resolution, file, line, symbol);
      return;
    }
    for (const name of names) {
      const channel = channelNodeOf(name, file, line);
      ctx.builder.addEdge({
        from: producerId,
        to: channel.id,
        type: 'emits',
        confidence: 'static',
        file,
        line,
        ...(payloadType === undefined ? {} : { params: [payloadType] }),
      });
    }
  };

  const emitSubscriber = (
    call: CallExpression,
    receiver: TsNode,
    pattern: { method: string; channelArg: number; handlerArg?: number; kind: string },
    owner: ClassDeclaration,
    method: ClassMethod,
    file: string,
    className: string,
  ): void => {
    const args = call.getArguments();
    const { line } = lineColOf(call);
    const symbol = `${className}.${method.getName()}`;

    const channelArg = args[pattern.channelArg];
    const resolution: ChannelResolution =
      channelArg === undefined
        ? { unresolved: 'channel-dynamic', text: call.getText().slice(0, 60) }
        : resolveChannelName(channelArg, ctx.config);
    const namespace = namespaceOf(openedBy(receiver, owner)?.getArguments()[0]);
    const names = channelsOf(resolution, namespace);
    // `socket.on('connect', …)` listens to the library, not to a service.
    if (isResolved(resolution) && 'namespace' in namespace && names.length === 0) return;

    const handler = pattern.handlerArg === undefined ? undefined : args[pattern.handlerArg];
    const target = handler === undefined ? undefined : targetOfHandler(handler, owner);
    const handlerMethod = target ?? method;
    if (handler !== undefined && target === undefined) {
      ctx.report({
        file,
        line,
        reason: 'consumer-handler-unresolved',
        hint: 'The listener does more than delegate, so the chain stops at the method that registered it.',
        symbol,
      });
    }

    const handlerId = ctx.methodIdOf(handlerMethod);
    if (handlerId === undefined) return;
    const consumerId = `consumer:${makeSymbolId(ctx.repo, file, className, handlerMethod.getName())}`;

    ctx.builder.addNode({
      id: consumerId,
      type: 'consumer',
      label: `${className}.${handlerMethod.getName()}`,
      repo: ctx.repo,
      file,
      line,
      kind: pattern.kind,
      meta: { kind: pattern.kind, adapter: SPEC.name, decorator: pattern.method, entryId: null },
    });
    ctx.ensureMethodNode(handlerMethod);
    ctx.builder.addEdge({
      from: consumerId,
      to: handlerId,
      type: 'handles',
      confidence: 'static',
      file,
      line,
    });

    if (names.length === 0) {
      if ('unreadable' in namespace) reportNamespace(namespace.unreadable, file, line, symbol);
      else reportChannel(resolution, file, line, symbol);
      return;
    }
    for (const name of names) {
      const channel = channelNodeOf(name, file, line);
      ctx.builder.addEdge({
        from: channel.id,
        to: consumerId,
        type: 'consumes',
        confidence: 'static',
        file,
        line,
      });
    }
  };

  for (const indexed of ctx.classes.all()) {
    if (indexed.role === 'module') continue;
    const owner = indexed.declaration;

    for (const { declaration: method, body } of methodBodies(owner)) {
      const methodId = ctx.methodIdOf(method);
      if (methodId === undefined) continue;
      const symbol = `${indexed.name}.${method.getName()}`;

      forEachCall(body, (node) => {
        const call = node as unknown as CallExpression;
        const callee = call.getExpression();
        if (!Node.isPropertyAccessExpression(callee)) return;
        const receiver = callee.getExpression();
        const name = callee.getName();

        for (const pattern of SPEC.producerPatterns) {
          if (name !== pattern.method || !receiverIsFrom(receiver, pattern)) continue;
          ctx.ensureMethodNode(method);
          emitProducer(call, receiver, pattern, owner, methodId, indexed.file, symbol);
          return;
        }
        for (const pattern of SPEC.subscriberPatterns ?? []) {
          if (name !== pattern.method || !receiverIsFrom(receiver, pattern)) continue;
          ctx.ensureMethodNode(method);
          emitSubscriber(call, receiver, pattern, owner, method, indexed.file, indexed.name);
          return;
        }
      });
    }
  }
});
