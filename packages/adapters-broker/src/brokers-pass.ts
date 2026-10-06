import {
  declaredParameterType,
  decoratorArgs,
  definePass,
  evaluateExpression,
  findDecorators,
  forEachCall,
  getDecorator,
  isEntryKind,
  makeChannelId,
  narrowUnionByLiteral,
  makeEntryId,
  makeLeafId,
  makeSymbolId,
  resolveTypeOrigin,
  type CallPattern,
  type ClassMethod,
  type EntryKind,
  type ExtractorPass,
  type GraphNode,
  type LocatorContext,
  type LocatorSite,
  type NameLocator,
  type TypeRef,
} from '@flowatlas/core';
// The context and the body walk, from the package neither extractor owns. This
// import is the whole of R46's answer at this end: a channel reader is not part
// of any extractor, so it names none, and the Angular reader that borrows its
// name resolution no longer inherits the Nest one through it.
import { scopesOf, type Holder, type PassContext, type Scope } from '@flowatlas/extract-scopes';
import type { CallExpression, ClassDeclaration, MethodDeclaration, Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import { brokerAdapters, createCustomBrokerAdapter, type BrokerSpec, type ConsumerPattern } from './adapters/index.js';
import {
  hasAcknowledgement,
  functionEvidence,
  methodMatches,
  receiverEvidence,
  receiverIsFrom,
  replyAt,
  targetOfHandler,
  type ReceiverEvidence,
} from './call-site.js';
import { addressOf, appliesAt, collapsed, readAddress, type AddressedElement } from './address.js';
import { payloadParameter, typeAtPath } from './payload.js';
import { isResolved, resolveChannelName, shapeChannelNames, type ChannelResolution } from './channel-name.js';
import { endpointShapingAt, isUnreadable, unreadableEndpointRow, type EndpointShaping } from './endpoint.js';
import { pairKey, readBrokerMarkers } from './markers.js';

const lineColOf = (node: TsNode): { line: number; column: number } =>
  node.getSourceFile().getLineAndColumnAtPos(node.getStart());

/**
 * The channel a site is addressed to, read through the locators of its pattern.
 *
 * Every locator is tried and the first that yields a readable name wins; when
 * none does, the first that pointed at anything is what the row reports, because
 * a reader acting on the row needs the expression that was actually looked at
 * rather than the whole call. A description that reached nothing at all has
 * nothing to show but the call, which is the last fallback.
 *
 * The fold rather than the walk is what lives here: the walk is the core's and is
 * shared with the side of the graph that reads stored collections, while what
 * counts as a name differs — a channel that cannot be read is a refusal with a
 * reason attached, and a table is simply absent. A locator that walks a list
 * reaches a channel per element, and a handler registered with one is a
 * handler of all of them.
 */
const channelAt = (
  site: LocatorSite,
  pattern: { readonly channel?: readonly NameLocator[]; readonly channelArg: number },
  context: LocatorContext,
  config: Parameters<typeof resolveChannelName>[1],
  fallback: string,
): ChannelResolution =>
  collapsed(readAddress(site, addressOf(pattern), undefined, context, config, fallback));

/**
 * What to do about a channel named by an environment variable.
 *
 * The variable is the one thing the code says, and the value is set by whatever
 * deploys it, so the row names the variable and where its value is: no channel
 * is drawn, because the variable's name is not the channel's.
 */
const environmentHint = (variable: string): string =>
  `The channel is the value of the environment variable ${variable}, which is set where this code is deployed and not in it, so no channel is drawn. ` +
  `Reading it from the deployment - the environment block of the function's Terraform - is not done yet; until it is, this publisher has no channel.`;

/** Every adapter that applies: the detected ones plus any described in configuration. */
export const brokerSpecsFor = (ctx: PassContext): BrokerSpec[] => {
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
export const extractBrokers = (ctx: PassContext): void => {
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
      hint:
        resolution.variable === undefined
          ? `The channel name cannot be read here. Annotate ${symbol} with the channel it uses.`
          : environmentHint(resolution.variable),
      symbol: `${symbol} -> ${resolution.text.slice(0, 60)}`,
      ...(resolution.variable === undefined ? {} : { meta: { variable: resolution.variable } }),
    });
  };

  /**
   * Whether the entry reader has already refused this handler's decorator.
   *
   * A pattern decorator's argument is read once, by the framework's entry
   * reader, and a consumer reuses that reading as its channel name (D1). Where
   * the entry reader could not read it, it has written a row at the handler
   * saying so, and the consumer, having read the same argument of the same
   * decorator, has nothing to add but a second row at one site for one thing to
   * fix. Worse than redundant for `@EventPattern()` with nothing in it: there
   * is no channel at all, and the channel row's advice - annotate with
   * `@Consumes` - would claim one for a handler the framework delivers nothing
   * to (R148). A decorator no entry reader knows - `@RabbitSubscribe`,
   * `@Process` - wrote no such row, so its consumer still reports its own.
   */
  const entryReaderRefused = (file: string, line: number, symbol: string): boolean =>
    ctx.builder.unresolved.some(
      (row) =>
        row.reason === 'decorator-arg-dynamic' &&
        row.file === file &&
        row.line === line &&
        row.symbol === symbol,
    );

  /**
   * The endpoint the channels sit under is stated, and it cannot be read.
   *
   * Reported once per call site rather than once per class, because a call site
   * is where a reader can do something about it, and because the row has to say
   * which publish or which handler lost its channel.
   */
  const reportEndpoint = (
    shaping: EndpointShaping,
    spec: BrokerSpec,
    file: string,
    line: number,
    symbol: string,
  ): void => {
    if (isUnreadable(shaping)) ctx.report(unreadableEndpointRow(shaping, spec, file, line, symbol));
  };

  /**
   * What the locators may ask about a call beyond the call itself.
   *
   * Two answers the reader already has and a locator cannot work out: the class
   * the receiver was declared as, and the constructor parameter that provided it.
   * A publish written outside a class has no injection to read, which is why the
   * second is absent there rather than guessed at.
   */
  const contextOf = (receiver: TsNode, owner: ClassDeclaration | undefined): LocatorContext => {
    const declaration = resolveTypeOrigin(receiver)?.declaration;
    const provider =
      owner !== undefined && Node.isPropertyAccessExpression(receiver)
        ? ctx.di.lookup(owner, receiver.getName())?.parameter
        : undefined;
    return {
      ...(declaration === undefined ? {} : { typeDeclaration: declaration }),
      ...(provider === undefined ? {} : { providerDeclaration: provider }),
    };
  };

  /**
   * Records one publish, wherever it is written.
   *
   * `holder` is the body the call sits in: a method, a module-level function, a
   * member of an object of functions, or a handler written in the registration.
   * The reader used to walk class methods only, so a publish from a module-level
   * function yielded no producer and no channel — and a Next.js route handler is
   * an exported function and never a method, so a handler that published an
   * event produced nothing at all (R54).
   */
  const emitProducer = (
    call: CallExpression,
    pattern: CallPattern,
    spec: BrokerSpec,
    holder: Holder,
    owner: ClassDeclaration | undefined,
    evidence: ReceiverEvidence,
  ): boolean => {
    const { id: methodId, file } = holder;
    const args = call.getArguments();
    const { line, column } = lineColOf(call);
    const callee = call.getExpression();
    const receiver = Node.isPropertyAccessExpression(callee) ? callee.getExpression() : callee;

    // One element per address the call is sent to: one for an ordinary publish,
    // one per entry for a call that sends a list of them.
    const elements = readAddress(
      call,
      addressOf(pattern),
      pattern.payload,
      contextOf(receiver, owner),
      ctx.config,
      // A receiver that is the channel and names nothing readable is best shown
      // as the receiver: `queue.add(job)` says nothing, and `queue` is the thing
      // a reader has to go and look at.
      pattern.channel !== undefined && pattern.address === undefined
        ? receiver.getText()
        : call.getText().slice(0, 60),
    );

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

    /**
     * What the call carries, read from an argument.
     *
     * What the channel carries is what the publishing method declares it takes.
     * The shape of one argument is only an instance of that, and is used only
     * when the declaration promises nothing.
     */
    const argumentPayload = (): string | undefined => {
      const payloadArg = pattern.payloadArg === undefined ? undefined : args[pattern.payloadArg];
      const declaredWide =
        pattern.payloadArg === undefined
          ? undefined
          : declaredParameterType(call, pattern.payloadArg, ctx.checker);
      // A bus declares every event it can carry; this call sends one of them.
      const declared =
        declaredWide !== undefined && payloadArg !== undefined
          ? narrowUnionByLiteral(declaredWide, payloadArg)
          : declaredWide;
      // Whichever of the two was read, the description says where in it the
      // message sits: the same value is a message on one transport and a record
      // carrying one on the next, and only the description knows which.
      const carried =
        declared !== undefined
          ? { type: declared, site: call as TsNode }
          : payloadArg === undefined
            ? undefined
            : { type: payloadArg.getType(), site: payloadArg };
      const carriedPayload =
        carried === undefined
          ? undefined
          : typeAtPath(carried.type, pattern.payloadPath ?? [], carried.site);
      return carried === undefined || carriedPayload === undefined
        ? undefined
        : ctx.types.collectType(carriedPayload, carried.site);
    };
    // A description that says where the message is written reads it per
    // element, as an expression; one that names an argument reads it once.
    const shared = pattern.payload === undefined ? argumentPayload() : undefined;
    const payloadOf = (element: AddressedElement): string | undefined =>
      pattern.payload === undefined
        ? shared
        : element.payload === undefined
          ? undefined
          : ctx.types.collectType(element.payload.getType(), element.payload);

    // The transport has the last word on the name the call wrote: an endpoint
    // the class declares is part of it, and a name the transport keeps for its
    // own signalling is not a channel at all.
    const shaping = endpointShapingAt(spec, owner, receiver);
    const readable = !isUnreadable(shaping);
    /** Every channel reached, once, with the first element that reached it. */
    const reached = new Map<string, AddressedElement>();
    if (readable) {
      for (const element of elements) {
        if (!isResolved(element.resolution)) continue;
        for (const name of shapeChannelNames(element.resolution.names, shaping)) {
          if (!reached.has(name)) reached.set(name, element);
        }
      }
    }
    const names = [...reached.keys()];
    const unread = elements.filter((element) => !isResolved(element.resolution));
    // Every name this call wrote belongs to the transport rather than to the
    // application, so there is nothing here to draw and nothing to report: the
    // library signalling to itself is not a publish.
    if (unread.length === 0 && readable && names.length === 0) return true;

    // A call that hands over somewhere to send the answer is a request, not a
    // publish, and the graph should not call the two the same thing.
    const acknowledgedKind =
      spec.acknowledgedKind !== undefined && hasAcknowledgement(args) ? spec.acknowledgedKind : undefined;
    const kind = acknowledgedKind ?? pattern.kind ?? 'event';
    // A request has an answer, and the answer is a second shape crossing the
    // same boundary: recorded as the edge's `returns`, the field a call to a
    // route carries its expected answer in, so that one comparison reads both.
    // A publish expects nothing back and is given nothing here (R151).
    const reply = kind === 'rpc' ? replyAt(call, acknowledgedKind !== undefined) : undefined;
    const replyType =
      reply === undefined ? undefined : ctx.types.collectType(ctx.types.unwrapAsync(reply), call);

    const producerId = makeLeafId('producer', ctx.repo, file, line, column);
    const channelName = names[0] ?? null;
    const firstRead = elements.map((element) => element.resolution).find(isResolved);
    const channelVia = firstRead === undefined ? 'unresolved' : firstRead.via;
    // An address one environment variable away from being read, said in the
    // shape a reader of the deployment completes it in: the parts it has, and
    // the variable standing in for each part it has not.
    const awaiting = unread.flatMap((element) => (element.awaiting === undefined ? [] : [element.awaiting]));
    // A receiver known only from what the source says it is constructed from
    // is what the author meant rather than what a compiler checked.
    const confidence = evidence === 'checked' ? 'static' : 'heuristic';
    // The label names every channel the address reaches, which is how the
    // marker path already spells a producer of several (R38). `name` is the
    // representative pattern and stays the dedupe key, but showing it alone
    // printed `order:*:*` for a producer that knows the three names behind it —
    // the wildcard the fold exists to remove, still on the screen (R44).
    const reaches = names.length > 0 ? names.join(', ') : undefined;
    // The body is now known to hold a publish, which is the point at which it
    // earns a node: `ensure` is deferred precisely so that the thousands of
    // functions in a repository that publish nothing stay out of the graph.
    holder.ensure();
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
        ...(awaiting.length === 0 ? {} : { awaiting }),
      },
    });
    ctx.builder.addEdge({
      from: methodId,
      to: producerId,
      type: 'calls',
      confidence: channelName === null ? 'heuristic' : confidence,
      file,
      line,
    });

    // The label the graph gives the body, which is what `doctor` joins a row
    // to when it asks whether an annotation here is justified. Asking the
    // node rather than spelling `Class.method` again is what lets a function
    // be named as a function rather than as a method of nothing.
    const symbol = ctx.builder.getNode(methodId)?.label ?? methodId;
    if (!readable) {
      if (channelName === null) reportEndpoint(shaping, spec, file, line, symbol);
    } else {
      // One row per thing to fix: two entries refused for the same reason at
      // the same expression are one row.
      const reported = new Set<string>();
      for (const element of unread) {
        const key = JSON.stringify(element.resolution);
        if (reported.has(key)) continue;
        reported.add(key);
        reportChannel(element.resolution, file, line, symbol);
      }
    }
    if (channelName === null) return true;

    // One edge per channel the address reaches. `alreadyStatic` records each of
    // them, so an `@Emits` naming any is recognised as saying what the code
    // already said rather than adding a second edge (R42).
    let carriesAny = false;
    for (const [name, element] of reached) {
      const channel = channelNodeOf(name, spec, file, line);
      alreadyStatic.add(pairKey(methodId, name));
      const payloadType = payloadOf(element);
      carriesAny ||= payloadType !== undefined;
      ctx.builder.addEdge({
        from: producerId,
        to: channel.id,
        type: 'emits',
        confidence,
        file,
        line,
        ...(payloadType === undefined ? {} : { params: [payloadType] }),
        ...(replyType === undefined ? {} : { returns: replyType }),
      });
    }
    if (!carriesAny) {
      ctx.report({
        file,
        line,
        reason: 'payload-type-unknown',
        hint:
          pattern.payload === undefined
            ? 'The call carries no payload argument, so nothing describes what travels on this channel.'
            : 'The message is not written out where the description says it is, so nothing describes what travels on this channel.',
        symbol: channelName,
      });
    }
    return true;
  };

  /**
   * The channel a decorated handler receives from.
   *
   * One decorator and one list of locators, whichever shape the transport uses.
   * The three branches this replaced — an argument, a key of an argument's object,
   * a decorator on the class — were three ways of saying where a name is written,
   * which is the one thing a locator says; and having them as branches meant a
   * transport whose handlers are marked `@OnJob({ name: … })` was describable on
   * the publishing side and not here.
   */
  const consumerChannel = (
    pattern: ConsumerPattern,
    method: MethodDeclaration,
    owner: ClassDeclaration,
  ): { resolution: ChannelResolution; jobName?: string | null } => {
    const site =
      pattern.classDecorator === undefined
        ? getDecorator(method, pattern.decorator)
        : getDecorator(owner, pattern.classDecorator);
    const nameDecorator =
      pattern.nameArgIndex === undefined ? undefined : getDecorator(method, pattern.decorator);
    const [nameArg] = nameDecorator === undefined ? [] : decoratorArgs(nameDecorator);
    const jobName =
      nameArg?.resolved === true && typeof nameArg.value === 'string' ? { jobName: nameArg.value } : {};
    if (site === undefined) {
      return { resolution: { unresolved: 'channel-dynamic', text: pattern.decorator }, ...jobName };
    }
    return {
      resolution: channelAt(
        site,
        { channel: pattern.channel, channelArg: -1 },
        {},
        ctx.config,
        // What a reader has to go and look at is the decorator that was supposed
        // to name the channel, not the method under it.
        site.getText().slice(0, 60),
      ),
      ...jobName,
    };
  };

  /**
   * The message a decorated handler is given, as the description locates it.
   *
   * Nothing at all where the description says nothing and the parameters say
   * nothing either, which is the honest answer and the one the comparison
   * already knows how to hold: a handler whose message cannot be found is
   * unchecked, not wrong.
   */
  const receivedPayload = (
    pattern: ConsumerPattern,
    method: MethodDeclaration,
  ): string | undefined => {
    const parameter = payloadParameter(method.getParameters(), pattern);
    if (parameter === undefined) return undefined;
    const carried = typeAtPath(parameter.getType(), pattern.payloadPath ?? [], parameter);
    return carried === undefined ? undefined : ctx.types.collectType(carried, parameter);
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
    const shaping = endpointShapingAt(spec, owner);
    const names = isResolved(resolution) && !isUnreadable(shaping)
      ? shapeChannelNames(resolution.names, shaping)
      : [];
    // A handler for one of the transport's own signals handles nothing the
    // application named, so there is no consumer of anything to record.
    if (isResolved(resolution) && !isUnreadable(shaping) && names.length === 0) return;
    const consumerId = `consumer:${makeSymbolId(ctx.repo, file, className, method.getName())}`;

    // The framework's own transports already produced an entry for this
    // handler; pointing at it keeps the two views of the same handler joined.
    // Where no entry reader knows the decorator - a worker's `@Process`, a
    // described bus's `@OnJob` - the way in is drawn here instead, in the same
    // shape and from the same helper the subscription side uses, so that both
    // spellings of one address land on one entry with an edge each.
    //
    // This is what R126 declined and what R133 made safe. Drawn as it stood
    // then, the entry turned `no-type-on-receiver` into `receiver requires
    // orderId; sender does not send it` on `fixtures/object-channels`: a queue
    // hands its handler the library's envelope while the publishing call may
    // have been described as taking the message itself, and nothing said which
    // of the two either end named. Now the description says where in each of
    // them the message sits, so the envelope is read as an envelope and the
    // message as the message.
    const known = ctx.entries.find((entry) => entry.handlerMethod === method)?.node.id ?? null;
    const entryId =
      known ??
      (names.length === 0
        ? null
        : entryOfHandler(names, pattern.kind, method, methodId, spec, file, line, receivedPayload(pattern, method)));
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
      else if (!entryReaderRefused(file, line, symbol)) reportChannel(resolution, file, line, symbol);
      return;
    }
    // One edge per channel the address reaches: a hole holding a closed set of
    // values is several channels, not one wildcard (R42). Each is recorded in
    // `alreadyStatic` for the same reason a publish is: a `@Consumes` naming any
    // of them says what the code already says, and has to read that way at both
    // ends of the channel rather than only at the publishing one (R45).
    for (const name of names) {
      const channel = channelNodeOf(name, spec, file, line);
      alreadyStatic.add(pairKey(methodId, name));
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

  /**
   * What a handler declares it is given, however the handler is written.
   *
   * A method states it directly; a field holding an arrow states it on the
   * arrow, which is how a handler keeps its `this` (R29) and is the shape the
   * chain from a subscription most often ends on. Anything else declares
   * nothing here, and says so by answering nothing rather than by answering an
   * empty signature.
   */
  const signatureOf = (
    handler: ClassMethod,
  ): { params: TypeRef[]; returns: TypeRef } | undefined => {
    if (Node.isMethodDeclaration(handler)) return ctx.types.collectSignature(handler);
    const written = handler.getInitializer();
    if (written === undefined) return undefined;
    if (!Node.isArrowFunction(written) && !Node.isFunctionExpression(written)) return undefined;
    return ctx.types.collectSignature(written);
  };

  /**
   * The way in a handler has, so that what it receives can be read.
   *
   * A handler declared by a decorator the framework's own entry reader knows
   * already has one: that reader makes an `entry` node for the pattern and
   * draws `handles` from it to the method, and everything downstream that asks
   * what a receiver is given asks that edge. A handler registered by a **call**
   * had none, so the question had nothing to answer with and every boundary
   * through it came back `no-type-on-receiver` - the row for a shape that
   * cannot be read at all, given for a shape written plainly in the source. The
   * parameter of the function handed to the call is the shape; what was missing
   * was a place to put it.
   *
   * A handler marked with a decorator **no** entry reader knows - a worker's
   * `@Process`, a described bus's `@OnJob` - was in exactly the same position,
   * and gets its way in from here too. The gap was never call versus decorator;
   * it was whether any reader knew the spelling (R133).
   *
   * So the same two facts are drawn here, in the same shape the entry side
   * uses: `entry:<service>:<kind>:<address>` and one `handles` edge carrying
   * the handler's signature. It is written here rather than in an entry reader
   * because only this pass knows a subscription happened, and the signature is
   * the target method's - the rule the types pass already applies to every
   * other `handles` edge - rather than a second judgement about what a receiver
   * receives. A subscription whose handler could not be followed lands on the
   * method that registered it, which declares no payload, so the row keeps
   * meaning what it says.
   *
   * The two spellings may reach the same node, and should: the id is the address
   * and the service, so a repository that declares one handler on `orders:created`
   * and registers another by a call has one way in with two `handles` edges out
   * of it, which is what the graph already says about a queue with two handlers.
   *
   * The kind is the transport's own word where the model has that word for a
   * way in, and `event` otherwise: a redis `message` and a socket `event` are
   * the same one-way arrival, and only the core says which kinds exist.
   */
  const entryOfHandler = (
    names: readonly string[],
    kind: string,
    handlerMethod: ClassMethod,
    handlerId: string,
    spec: BrokerSpec,
    file: string,
    line: number,
    body?: string,
  ): string | null => {
    const entryKind: EntryKind = isEntryKind(kind) ? kind : 'event';
    const signature = signatureOf(handlerMethod);
    let first: string | null = null;
    for (const name of names) {
      const id = makeEntryId(ctx.repo, entryKind, name);
      ctx.builder.addNode({
        id,
        type: 'entry',
        label: `${entryKind} ${name}`,
        repo: ctx.repo,
        file,
        line,
        kind: entryKind,
        meta: { pattern: name, adapter: spec.name },
      });
      ctx.builder.addEdge({
        from: id,
        to: handlerId,
        type: 'handles',
        confidence: 'static',
        file,
        line,
        ...(signature === undefined ? {} : signature),
        // Where the handler's parameters are not the message itself, the
        // message is named here: the same key a route's body is named with, so
        // that everything downstream asking what a receiver is given keeps
        // asking one question (R133).
        ...(body === undefined ? {} : { meta: { body } }),
      });
      first ??= id;
    }
    return first;
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
          const spelling = callee.getName();
          if (!methodMatches(spelling, pattern.method)) continue;
          if (!receiverIsFrom(callee.getExpression(), pattern)) continue;

          const args = call.getArguments();
          const resolution = channelAt(
            call,
            pattern,
            contextOf(callee.getExpression(), owner),
            ctx.config,
            call.getText().slice(0, 60),
          );
          const { line } = lineColOf(call);
          const shaping = endpointShapingAt(spec, owner, callee.getExpression());
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

          ctx.ensureMethodNode(handlerMethod);
          // Drawn before the consumer, because the consumer records which entry
          // it answers and a `null` there is exactly what this used to say.
          const entryId = entryOfHandler(
            names,
            pattern.kind,
            handlerMethod,
            handlerId,
            spec,
            file,
            line,
          );

          ctx.builder.addNode({
            id: consumerId,
            type: 'consumer',
            label: `${className}.${handlerMethod.getName()}`,
            repo: ctx.repo,
            file,
            line,
            kind: pattern.kind,
            // The spelling written at the call site, not the first the
            // description happens to list: what a reader opening the file sees.
            meta: { kind: pattern.kind, adapter: spec.name, decorator: spelling, entryId },
          });
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
          // Recorded against the handler, which is the method a `@Consumes`
          // would be written on — not against the method that registered the
          // subscription, which is usually `onModuleInit` and annotates nothing.
          for (const name of names) {
            const channel = channelNodeOf(name, spec, file, line);
            alreadyStatic.add(pairKey(handlerId, name));
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

  /**
   * How a publishing call is known to be one a pattern describes, if it is.
   *
   * The method and the receiver, as for every call, or the function's own name
   * for a helper written as a function; and for a pattern that names the
   * command it sends, that command, because the same method sends every other
   * kind too.
   */
  const evidenceFor = (pattern: CallPattern, call: CallExpression): ReceiverEvidence | undefined => {
    const callee = call.getExpression();
    const evidence =
      pattern.calledAs === 'function'
        ? functionEvidence(callee, pattern.method)
        : Node.isPropertyAccessExpression(callee) && methodMatches(callee.getName(), pattern.method)
          ? receiverEvidence(callee.getExpression(), pattern)
          : undefined;
    return evidence !== undefined && appliesAt(call, pattern) ? evidence : undefined;
  };

  /**
   * Receiving, for a body that is a method of an indexed class.
   *
   * Both ways a handler is registered — a decorator on the method, and a
   * subscribe call that hands over one of the class's own methods — need the
   * class the method belongs to, so this half stays class-shaped and is asked
   * only of the scopes that have one. It is read in the same pass as the
   * publish rather than in a walk of its own so that the two keep arriving in
   * the order they are written in: a channel node records the first place it
   * was seen, and splitting the walks moved that from the handler to the
   * publish for every channel both ends of a repository name.
   */
  const readReceiving = (scope: Scope): void => {
    const { owner, method } = scope;
    // A handler is registered by a decorator, and a decorator on a property
    // registers nothing in any of these frameworks: what it publishes is read
    // above, and there is no subscription here to find.
    if (owner === undefined || method === undefined || !Node.isMethodDeclaration(method)) return;
    // There is deliberately no test here that the graph already holds this
    // method. Receiving was the last reader that asked, and it asked for the
    // same reason the other two did: before the emitters learned to create the
    // node a leaf hangs off, an edge to a method nobody had added went nowhere,
    // so the gate stood in for a node that did not exist yet. It no longer
    // stands in for anything — `emitConsumer` and `emitSubscribers` both call
    // `ensureMethodNode` before they draw — and what it did instead was hide a
    // decorated handler on a class no route and no call reaches, which is the
    // ordinary shape of a worker whose only way in is the channel itself.
    // Unreached is not unwritten: a handler is a fact about the source, and the
    // reader's job is to say what the source says (R60).
    const className = ctx.classes.get(owner)?.name ?? owner.getName() ?? '?';
    const file = scope.file;

    emitSubscribers(method, owner, file, className);

    for (const spec of specs) {
      for (const pattern of spec.consumerPatterns) {
        if (pattern.classDecorator !== undefined && pattern.nameArgIndex === undefined) {
          // A worker class handles its queue through one named method.
          if (method.getName() !== 'process') continue;
          if (getDecorator(owner, pattern.classDecorator) === undefined) continue;
        } else if (findDecorators(method, { names: [pattern.decorator] }).length === 0) {
          continue;
        }
        emitConsumer(method, owner, pattern, spec, file, className);
      }
    }
  };

  // A publish is read wherever it is written: a method, a module-level
  // function, a member of an object of functions, a handler written in the
  // registration. The walk is the data-layer reader's walk too, taken from
  // `@flowatlas/extract-scopes` rather than copied here, because two copies of
  // the judgement "what counts as a body" diverge the first time one of them is
  // reconsidered (R54).
  for (const scope of scopesOf(ctx)) {
    forEachCall(scope.body, (call) => {
      const expression = call as unknown as CallExpression;
      for (const spec of specs) {
        for (const pattern of spec.producerPatterns) {
          const evidence = evidenceFor(pattern, expression);
          if (evidence === undefined) continue;
          emitProducer(expression, pattern, spec, scope, scope.owner, evidence);
          return;
        }
      }
    });

    readReceiving(scope);
  }

  readBrokerMarkers(ctx, specs[0] ?? brokerAdapters[0], alreadyStatic);
};

export const brokersPass: ExtractorPass<PassContext> = definePass('brokers', extractBrokers);
