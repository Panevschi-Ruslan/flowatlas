import {
  declaredParameterType,
  makeChannelId,
  narrowUnionByLiteral,
  makeLeafId,
  makeSymbolId,
  methodBodies,
  resolveTypeOrigin,
  type CallPattern,
  type GraphNode,
  type TypeOrigin,
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
import { isResolved, resolveChannelName, type ChannelResolution } from './channel-name.js';
import { pairKey, readBrokerMarkers } from './markers.js';

const WALKED = new Set(['controller', 'injectable', 'guard', 'interceptor', 'pipe', 'middleware', 'plain']);

const lineColOf = (node: TsNode): { line: number; column: number } =>
  node.getSourceFile().getLineAndColumnAtPos(node.getStart());

/**
 * Whether the value a call is made on is the one a pattern names.
 *
 * A library is identified by the package that declares it; a bus a project wrote
 * itself has no package, so the type as written at the call site is all there is.
 * A pattern naming neither matches nothing, which is why the last answer is no
 * rather than yes: a method name alone is not evidence of anything.
 */
const receiverMatches = (
  origin: TypeOrigin | null,
  pattern: { receiverType?: string | readonly string[]; receiverPackages?: readonly string[] },
): boolean => {
  if (pattern.receiverType !== undefined) {
    const names =
      typeof pattern.receiverType === 'string' ? [pattern.receiverType] : pattern.receiverType;
    return origin !== null && names.includes(origin.typeName);
  }
  if (pattern.receiverPackages !== undefined) {
    return origin?.package != null && pattern.receiverPackages.includes(origin.package);
  }
  return false;
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
          : { name, via: 'const' };
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
      pattern.payloadArg === undefined
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

    const producerId = makeLeafId('producer', ctx.repo, file, line, column);
    const channelName = isResolved(resolution) ? resolution.name : null;
    const channelVia = isResolved(resolution) ? resolution.via : 'unresolved';
    ctx.builder.addNode({
      id: producerId,
      type: 'producer',
      label: `${pattern.kind ?? 'event'} ${channelName ?? '?'}`,
      repo: ctx.repo,
      file,
      line,
      kind: pattern.kind ?? 'event',
      meta: {
        kind: pattern.kind ?? 'event',
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
      reportChannel(resolution, file, line, `${owner.getName() ?? '?'}.${methodId.split('.').pop() ?? ''}`);
      return true;
    }

    const channel = channelNodeOf(channelName, spec, file, line);
    alreadyStatic.add(pairKey(methodId, channelName));
    ctx.builder.addEdge({
      from: producerId,
      to: channel.id,
      type: 'emits',
      confidence: 'static',
      file,
      line,
      ...(payloadType === undefined ? {} : { params: [payloadType] }),
    });
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
            ? { name: queue, via: 'const' }
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

    if (!isResolved(resolution)) {
      reportChannel(resolution, file, line, `${className}.${method.getName()}`);
      return;
    }
    const channel = channelNodeOf(resolution.name, spec, file, line);
    ctx.builder.addEdge({
      from: channel.id,
      to: consumerId,
      type: 'consumes',
      confidence: 'static',
      file,
      line,
    });
  };

  /**
   * The method a listener ultimately runs.
   *
   * A handler that does exactly one thing is really an alias for that thing, and
   * pointing the chain at it is what a reader wants. A handler that does several
   * is its own step, and saying so beats picking one of them.
   */
  const targetOfHandler = (
    handler: TsNode,
    owner: ClassDeclaration,
  ): MethodDeclaration | undefined => {
    const body = Node.isArrowFunction(handler) || Node.isFunctionExpression(handler)
      ? handler.getBody()
      : undefined;
    if (body === undefined) return undefined;
    const called: MethodDeclaration[] = [];
    // A concise arrow body is the call itself, not a descendant of one.
    const visit = (node: TsNode): void => {
      if (!Node.isCallExpression(node)) return;
      const callee = node.getExpression();
      if (!Node.isPropertyAccessExpression(callee)) return;
      if (!Node.isThisExpression(callee.getExpression())) return;
      const found = owner.getMethod(callee.getName());
      if (found !== undefined) called.push(found);
    };
    visit(body);
    body.forEachDescendant(visit);
    const unique = [...new Set(called)];
    return unique.length === 1 ? unique[0] : undefined;
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
          if (!receiverMatches(resolveTypeOrigin(callee.getExpression()), pattern)) continue;

          const args = call.getArguments();
          const channelArg = args[pattern.channelArg];
          const resolution =
            channelArg === undefined
              ? { unresolved: 'channel-dynamic' as const, text: call.getText().slice(0, 60) }
              : resolveChannelName(channelArg, ctx.config);
          const { line } = lineColOf(call);

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

          if (!isResolved(resolution)) {
            reportChannel(resolution, file, line, `${className}.${method.getName()}`);
            continue;
          }
          const channel = channelNodeOf(resolution.name, spec, file, line);
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
  };

  const matches = (pattern: CallPattern, receiver: TsNode, method: string): boolean =>
    pattern.method === method && receiverMatches(resolveTypeOrigin(receiver), pattern);

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
