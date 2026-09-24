import {
  declaredParameterType,
  makeChannelId,
  narrowUnionByLiteral,
  makeLeafId,
  makeSymbolId,
  methodBodies,
  type CallPattern,
  type GraphNode,
} from '@flowatlas/core';
import {
  decoratorArgs,
  definePass,
  evaluateExpression,
  findDecorators,
  forEachCall,
  getDecorator,
  type NestExtractContext,
  type NestExtractorPass,
} from '@flowatlas/extractor-nestjs';
import type { CallExpression, ClassDeclaration, MethodDeclaration, Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import { brokerAdapters, createCustomBrokerAdapter, type BrokerSpec, type ConsumerPattern } from './adapters/index.js';
import { hasAcknowledgement, receiverIsFrom, targetOfHandler } from './call-site.js';
import {
  isResolved,
  resolveChannelName,
  shapeChannelNames,
  trimEndpoint,
  type ChannelResolution,
  type ChannelShaping,
} from './channel-name.js';
import { pairKey, readBrokerMarkers } from './markers.js';

const WALKED = new Set(['controller', 'injectable', 'guard', 'interceptor', 'pipe', 'middleware', 'plain']);

const lineColOf = (node: TsNode): { line: number; column: number } =>
  node.getSourceFile().getLineAndColumnAtPos(node.getStart());

/**
 * What the class a call sits in says about the names written in it.
 *
 * Either the transport's rules applied to this class, or the one case where
 * the class declares an endpoint and that endpoint cannot be read. The second
 * is not a detail to shrug at: falling back to the default endpoint would put
 * every channel of a namespaced gateway on the node the unnamespaced ones use,
 * and quietly join services that never speak.
 */
type ClassShaping = ChannelShaping | { readonly unreadable: string };

const isUnreadable = (shaping: ClassShaping): shaping is { readonly unreadable: string } =>
  'unreadable' in shaping;

const shapingOf = (owner: ClassDeclaration, spec: BrokerSpec): ClassShaping => {
  const reserved = spec.reservedChannels;
  const base: ChannelShaping = reserved === undefined ? {} : { reserved };
  const shape = spec.channelPrefix;
  if (shape === undefined) return base;
  const decorator = getDecorator(owner, shape.classDecorator);
  if (decorator === undefined) return base;
  for (const argument of decorator.getArguments()) {
    if (!Node.isObjectLiteralExpression(argument)) continue;
    const property = argument.getProperty(shape.optionKey);
    if (property === undefined || !Node.isPropertyAssignment(property)) continue;
    const initializer = property.getInitializer();
    if (initializer === undefined) return { unreadable: property.getText() };
    const value = evaluateExpression(initializer);
    if (!value.resolved || typeof value.value !== 'string') {
      return { unreadable: initializer.getText() };
    }
    return { ...base, prefix: trimEndpoint(value.value), separator: shape.separator };
  }
  return base;
};

/** Every adapter that applies: the detected ones plus any described in configuration. */
export const brokerSpecsFor = (ctx: NestExtractContext): BrokerSpec[] => {
  const detected = new Set(ctx.adapters.broker.map((adapter) => adapter.name));
  const specs = brokerAdapters.filter((spec) => detected.has(spec.name));
  return [...specs, ...ctx.config.adapters.broker.custom.map(createCustomBrokerAdapter)];
};

/**
 * Publishing, receiving, and the channels in between.
 *
 * A channel node carries no repository prefix, which is the whole point of it:
 * a producer in one service and a handler in another have to land on the same
 * node for the two to be joined later. A channel whose name cannot be read
 * therefore produces no node at all, only a producer and a row saying which
 * annotation would fix it, because a guessed name would join two services that
 * never speak.
 */
export const extractBrokers = (ctx: NestExtractContext): void => {
  const specs = brokerSpecsFor(ctx);
  if (specs.length === 0) return;

  /** Method and channel pairs the code itself already states. */
  const alreadyStatic = new Set<string>();

  const channelNodeOf = (name: string, spec: BrokerSpec, file: string, line: number): GraphNode => {
    const id = makeChannelId(name);
    const existing = ctx.builder.getNode(id);
    const adapters = new Set([
      ...((existing?.meta?.['adapters'] as string[] | undefined) ?? []),
      spec.name,
    ]);
    const node = ctx.builder.addNode({
      id,
      type: 'channel',
      label: name,
      repo: ctx.repo,
      file,
      line,
      meta: { channelKind: spec.channelKind, adapters: [...adapters] },
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
      hint: `The channel name cannot be read here. Annotate ${symbol} with the channel it uses.`,
      symbol: `${symbol} -> ${resolution.text.slice(0, 60)}`,
    });
  };

  /**
   * The class declares the endpoint its channels sit under, and it cannot be read.
   *
   * Reported once per call site rather than once per class, because a call site
   * is where a reader can do something about it, and because the row has to say
   * which publish or which handler lost its channel.
   */
  const reportEndpoint = (
    shaping: { readonly unreadable: string },
    spec: BrokerSpec,
    file: string,
    line: number,
    symbol: string,
  ): void => {
    const option = spec.channelPrefix?.optionKey ?? 'endpoint';
    ctx.report({
      file,
      line,
      reason: 'channel-dynamic',
      hint: `The ${option} this class declares cannot be read, so neither can any channel name under it. Write it as a literal or a constant.`,
      symbol: `${symbol} -> ${shaping.unreadable.slice(0, 60)}`,
    });
  };

  /** The queue a receiver is bound to, named on the parameter that injected it. */
  const channelFromParameter = (
    owner: ClassDeclaration,
    receiver: TsNode,
    decoratorName: string,
  ): string | undefined => {
    if (!Node.isPropertyAccessExpression(receiver)) return undefined;
    const entry = ctx.di.lookup(owner, receiver.getName());
    if (entry?.parameter === undefined) return undefined;
    const decorator = getDecorator(entry.parameter, decoratorName);
    if (decorator === undefined) return undefined;
    const [first] = decoratorArgs(decorator);
    return first?.resolved === true && typeof first.value === 'string' ? first.value : undefined;
  };

  const emitProducer = (
    call: CallExpression,
    pattern: CallPattern,
    spec: BrokerSpec,
    owner: ClassDeclaration,
    methodId: string,
    file: string,
  ): boolean => {
    const args = call.getArguments();
    const { line, column } = lineColOf(call);
    const callee = call.getExpression();
    const receiver = Node.isPropertyAccessExpression(callee) ? callee.getExpression() : callee;

    let resolution: ChannelResolution;
    if (pattern.channelArg < 0) {
      const name =
        pattern.channelFromParameterDecorator === undefined
          ? undefined
          : channelFromParameter(owner, receiver, pattern.channelFromParameterDecorator);
      resolution =
        name === undefined
          ? { unresolved: 'channel-dynamic', text: receiver.getText() }
          : { name, names: [name], via: 'const' };
    } else {
      const argument = args[pattern.channelArg];
      resolution =
        argument === undefined
          ? { unresolved: 'channel-dynamic', text: call.getText().slice(0, 60) }
          : resolveChannelName(argument, ctx.config);
    }

    const jobNameArg = pattern.nameArg === undefined ? undefined : args[pattern.nameArg];
    const jobName =
      jobNameArg === undefined
        ? undefined
        : (() => {
            const value = evaluateExpression(jobNameArg);
            return value.resolved && typeof value.value === 'string' ? value.value : null;
          })();

    const exchangeArg = pattern.exchangeArg === undefined ? undefined : args[pattern.exchangeArg];
    const exchange =
      exchangeArg === undefined
        ? undefined
        : (() => {
            const value = evaluateExpression(exchangeArg);
            return value.resolved && typeof value.value === 'string' ? value.value : null;
          })();

    const payloadArg = pattern.payloadArg === undefined ? undefined : args[pattern.payloadArg];
    // What the channel carries is what the publishing method declares it takes.
    // The shape of one argument is only an instance of that, and is used only
    // when the declaration promises nothing.
    const declaredWide =
      pattern.payloadArg === undefined || spec.payloadFromCallSite === true
        ? undefined
        : declaredParameterType(call, pattern.payloadArg, ctx.checker);
    // A bus declares every event it can carry; this call sends one of them.
    const declared =
      declaredWide !== undefined && payloadArg !== undefined
        ? narrowUnionByLiteral(declaredWide, payloadArg)
        : declaredWide;
    const payloadType =
      declared !== undefined
        ? ctx.types.collectType(declared, call)
        : payloadArg === undefined
          ? undefined
          : ctx.types.collectType(payloadArg.getType(), payloadArg);

    // The transport has the last word on the name the call wrote: an endpoint
    // the class declares is part of it, and a name the transport keeps for its
    // own signalling is not a channel at all.
    const shaping = shapingOf(owner, spec);
    const names = isResolved(resolution) && !isUnreadable(shaping)
      ? shapeChannelNames(resolution.names, shaping)
      : [];
    // Every name this call wrote belongs to the transport rather than to the
    // application, so there is nothing here to draw and nothing to report: the
    // library signalling to itself is not a publish.
    if (isResolved(resolution) && !isUnreadable(shaping) && names.length === 0) return true;

    // A call that hands over somewhere to send the answer is a request, not a
    // publish, and the graph should not call the two the same thing.
    const kind =
      spec.acknowledgedKind !== undefined && hasAcknowledgement(args)
        ? spec.acknowledgedKind
        : (pattern.kind ?? 'event');

    const producerId = makeLeafId('producer', ctx.repo, file, line, column);
    const channelName = names[0] ?? null;
    const channelVia = isResolved(resolution) ? resolution.via : 'unresolved';
    // The label names every channel the address reaches, which is how the
    // marker path already spells a producer of several (R38). `name` is the
    // representative pattern and stays the dedupe key, but showing it alone
    // printed `order:*:*` for a producer that knows the three names behind it —
    // the wildcard the fold exists to remove, still on the screen (R44).
    const reaches = names.length > 0 ? names.join(', ') : undefined;
    ctx.builder.addNode({
      id: producerId,
      type: 'producer',
      label: `${kind} ${reaches ?? '?'}`,
      repo: ctx.repo,
      file,
      line,
      kind,
      meta: {
        kind,
        adapter: spec.name,
        channelVia,
        method: pattern.method,
        ...(jobName === undefined ? {} : { jobName }),
        ...(exchange === undefined ? {} : { exchange }),
      },
    });
    ctx.builder.addEdge({
      from: methodId,
      to: producerId,
      type: 'calls',
      confidence: channelName === null ? 'heuristic' : 'static',
      file,
      line,
    });

    if (channelName === null) {
      const symbol = `${owner.getName() ?? '?'}.${methodId.split('.').pop() ?? ''}`;
      if (isUnreadable(shaping)) reportEndpoint(shaping, spec, file, line, symbol);
      else reportChannel(resolution, file, line, symbol);
      return true;
    }

    // One edge per channel the address reaches. `alreadyStatic` records each of
    // them, so an `@Emits` naming any is recognised as saying what the code
    // already said rather than adding a second edge (R42).
    for (const name of names) {
      const channel = channelNodeOf(name, spec, file, line);
      alreadyStatic.add(pairKey(methodId, name));
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
    if (payloadType === undefined) {
      ctx.report({
        file,
        line,
        reason: 'payload-type-unknown',
        hint: 'The call carries no payload argument, so nothing describes what travels on this channel.',
        symbol: channelName,
      });
    }
    return true;
  };

  /** The channel a decorated handler receives from. */
  const consumerChannel = (
    pattern: ConsumerPattern,
    method: MethodDeclaration,
    owner: ClassDeclaration,
  ): { resolution: ChannelResolution; jobName?: string | null } => {
    if (pattern.channelFrom === 'class-decorator') {
      const classDecorator =
        pattern.classDecorator === undefined ? undefined : getDecorator(owner, pattern.classDecorator);
      const [first] = classDecorator === undefined ? [] : decoratorArgs(classDecorator);
      const queue =
        first?.resolved === true && typeof first.value === 'string'
          ? first.value
          : first?.resolved === true && typeof first.value === 'object' && first.value !== null
            ? (first.value as { name?: unknown }).name
            : undefined;
      const nameDecorator = getDecorator(method, pattern.decorator);
      const [nameArg] =
        nameDecorator === undefined || pattern.nameArgIndex === undefined
          ? []
          : decoratorArgs(nameDecorator);
      return {
        resolution:
          typeof queue === 'string'
            ? { name: queue, names: [queue], via: 'const' }
            : { unresolved: 'channel-dynamic', text: owner.getName() ?? '?' },
        ...(nameArg?.resolved === true && typeof nameArg.value === 'string'
          ? { jobName: nameArg.value }
          : {}),
      };
    }

    const decorator = getDecorator(method, pattern.decorator);
    const [first] = decorator === undefined ? [] : decorator.getArguments();
    if (first === undefined) {
      return { resolution: { unresolved: 'channel-dynamic', text: pattern.decorator } };
    }
    if (pattern.channelFrom === 'option') {
      if (!Node.isObjectLiteralExpression(first)) {
        return { resolution: { unresolved: 'channel-dynamic', text: first.getText() } };
      }
      const property = first.getProperty(pattern.optionKey ?? '');
      const initializer =
        property !== undefined && Node.isPropertyAssignment(property)
          ? property.getInitializer()
          : undefined;
      return {
        resolution:
          initializer === undefined
            ? { unresolved: 'channel-dynamic', text: first.getText().slice(0, 60) }
            : resolveChannelName(initializer, ctx.config),
      };
    }
    return { resolution: resolveChannelName(first, ctx.config) };
  };

  const emitConsumer = (
    method: MethodDeclaration,
    owner: ClassDeclaration,
    pattern: ConsumerPattern,
    spec: BrokerSpec,
    file: string,
    className: string,
  ): void => {
    const methodId = ctx.methodIdOf(method);
    if (methodId === undefined) return;
    const { line } = lineColOf(method);
    const { resolution, jobName } = consumerChannel(pattern, method, owner);
    const shaping = shapingOf(owner, spec);
    const names = isResolved(resolution) && !isUnreadable(shaping)
      ? shapeChannelNames(resolution.names, shaping)
      : [];
    // A handler for one of the transport's own signals handles nothing the
    // application named, so there is no consumer of anything to record.
    if (isResolved(resolution) && !isUnreadable(shaping) && names.length === 0) return;
    const consumerId = `consumer:${makeSymbolId(ctx.repo, file, className, method.getName())}`;

    // The framework's own transports already produced an entry for this handler;
    // pointing at it keeps the two views of the same handler joined.
    const entryId = ctx.entries.find((entry) => entry.handlerMethod === method)?.node.id ?? null;
    const returns = ctx.types.collectSignature(method).returns;

    ctx.builder.addNode({
      id: consumerId,
      type: 'consumer',
      label: `${className}.${method.getName()}`,
      repo: ctx.repo,
      file,
      line,
      kind: pattern.kind,
      meta: {
        kind: pattern.kind,
        adapter: spec.name,
        decorator: pattern.decorator,
        entryId,
        ...(jobName === undefined ? {} : { jobName }),
      },
    });
    ctx.ensureMethodNode(method);
    ctx.builder.addEdge({
      from: consumerId,
      to: methodId,
      type: 'handles',
      confidence: 'static',
      file,
      line,
      returns,
    });

    if (names.length === 0) {
      const symbol = `${className}.${method.getName()}`;
      if (isUnreadable(shaping)) reportEndpoint(shaping, spec, file, line, symbol);
      else reportChannel(resolution, file, line, symbol);
      return;
    }
    // One edge per channel the address reaches: a hole holding a closed set of
    // values is several channels, not one wildcard (R42).
    for (const name of names) {
      const channel = channelNodeOf(name, spec, file, line);
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

  const emitSubscribers = (
    method: MethodDeclaration,
    owner: ClassDeclaration,
    file: string,
    className: string,
  ): void => {
    const body = method.getBody();
    if (body === undefined) return;

    const calls: CallExpression[] = [];
    forEachCall(body, (call) => calls.push(call as unknown as CallExpression));

    for (const spec of specs) {
      for (const pattern of spec.subscriberPatterns ?? []) {
        for (const call of calls) {
          const callee = call.getExpression();
          if (!Node.isPropertyAccessExpression(callee)) continue;
          if (callee.getName() !== pattern.method) continue;
          if (!receiverIsFrom(callee.getExpression(), pattern)) continue;

          const args = call.getArguments();
          const channelArg = args[pattern.channelArg];
          const resolution =
            channelArg === undefined
              ? { unresolved: 'channel-dynamic' as const, text: call.getText().slice(0, 60) }
              : resolveChannelName(channelArg, ctx.config);
          const { line } = lineColOf(call);
          const shaping = shapingOf(owner, spec);
          const names = isResolved(resolution) && !isUnreadable(shaping)
            ? shapeChannelNames(resolution.names, shaping)
            : [];
          // The transport's own signals — a socket saying it connected — are
          // registered with the same call as an application event. Listening
          // for one is not consuming anything the application named.
          if (isResolved(resolution) && !isUnreadable(shaping) && names.length === 0) continue;

          // The handler is either this call's own argument or one registered
          // separately on the same receiver.
          let handler = pattern.handlerArg === undefined ? undefined : args[pattern.handlerArg];
          if (handler === undefined && pattern.listenerMethod !== undefined) {
            const receiverText = callee.getExpression().getText();
            for (const other of calls) {
              const otherCallee = other.getExpression();
              if (!Node.isPropertyAccessExpression(otherCallee)) continue;
              if (otherCallee.getName() !== pattern.listenerMethod) continue;
              // Two subscriptions in one method each have their own listener.
              if (otherCallee.getExpression().getText() !== receiverText) continue;
              const [eventArg, handlerArg] = other.getArguments();
              const event = eventArg === undefined ? undefined : evaluateExpression(eventArg);
              if (event?.resolved !== true || event.value !== pattern.listenerEvent) continue;
              handler = handlerArg;
              break;
            }
          }

          const target = handler === undefined ? undefined : targetOfHandler(handler, owner);
          const handlerMethod = target ?? method;
          if (handler !== undefined && target === undefined) {
            ctx.report({
              file,
              line,
              reason: 'consumer-handler-unresolved',
              hint: 'The listener does more than delegate, so the chain stops at the method that registered it.',
              symbol: `${className}.${method.getName()}`,
            });
          }

          const handlerId = ctx.methodIdOf(handlerMethod);
          if (handlerId === undefined) continue;
          const consumerId = `consumer:${makeSymbolId(ctx.repo, file, className, handlerMethod.getName())}`;

          ctx.builder.addNode({
            id: consumerId,
            type: 'consumer',
            label: `${className}.${handlerMethod.getName()}`,
            repo: ctx.repo,
            file,
            line,
            kind: pattern.kind,
            meta: { kind: pattern.kind, adapter: spec.name, decorator: pattern.method, entryId: null },
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
            const symbol = `${className}.${method.getName()}`;
            if (isUnreadable(shaping)) reportEndpoint(shaping, spec, file, line, symbol);
            else reportChannel(resolution, file, line, symbol);
            continue;
          }
          for (const name of names) {
            const channel = channelNodeOf(name, spec, file, line);
            ctx.builder.addEdge({
              from: channel.id,
              to: consumerId,
              type: 'consumes',
              confidence: 'static',
              file,
              line,
            });
          }
        }
      }
    }
  };

  const matches = (pattern: CallPattern, receiver: TsNode, method: string): boolean =>
    pattern.method === method && receiverIsFrom(receiver, pattern);

  for (const indexed of ctx.classes.all()) {
    if (!WALKED.has(indexed.role)) continue;
    const owner = indexed.declaration;
    const file = indexed.file;

    for (const { declaration: method, body } of methodBodies(owner)) {
      const methodId = ctx.methodIdOf(method);
      if (methodId === undefined || !ctx.builder.has(methodId)) continue;

      {
        forEachCall(body, (call) => {
          const expression = call as unknown as CallExpression;
          const callee = expression.getExpression();
          if (!Node.isPropertyAccessExpression(callee)) return;
          const receiver = callee.getExpression();
          const name = callee.getName();
          for (const spec of specs) {
            for (const pattern of spec.producerPatterns) {
              if (!matches(pattern, receiver, name)) continue;
              emitProducer(expression, pattern, spec, owner, methodId, file);
              return;
            }
          }
        });
      }

      // A handler is registered by a decorator, and a decorator on a property
      // registers nothing in any of these frameworks: what it publishes is read
      // above, and there is no subscription here to find.
      if (!Node.isMethodDeclaration(method)) continue;

      emitSubscribers(method, owner, file, indexed.name);

      for (const spec of specs) {
        for (const pattern of spec.consumerPatterns) {
          if (pattern.channelFrom === 'class-decorator' && pattern.nameArgIndex === undefined) {
            // A worker class handles its queue through one named method.
            if (method.getName() !== 'process') continue;
            if (getDecorator(owner, pattern.classDecorator ?? '') === undefined) continue;
          } else if (findDecorators(method, { names: [pattern.decorator] }).length === 0) {
            continue;
          }
          emitConsumer(method, owner, pattern, spec, file, indexed.name);
        }
      }
    }
  }

  readBrokerMarkers(ctx, specs[0] ?? brokerAdapters[0], alreadyStatic);
};

export const brokersPass: NestExtractorPass = definePass('brokers', extractBrokers);
