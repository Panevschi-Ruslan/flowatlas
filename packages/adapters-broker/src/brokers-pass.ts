import {
  AWAITING_META,
  GUESSED_META,
  RECORDED_META,
  WHERE_DECLARED_META,
  declaredParameterType,
  decoratorArgs,
  definePass,
  evaluateExpression,
  findDecorators,
  forEachCall,
  type Forwarded,
  forwardedFrom,
  forwardNoWorse,
  getDecorator,
  isEntryKind,
  makeChannelId,
  narrowUnionByLiteral,
  makeEntryId,
  makeLeafId,
  makeSymbolId,
  resolveTypeOrigin,
  type AwaitedAddress,
  type CallPattern,
  type ClassMethod,
  type NamedFunction,
  type EntryKind,
  type ExtractorPass,
  type GraphNode,
  type LocatorContext,
  type LocatorSite,
  type NameLocator,
  type TypeRef,
  lineAndColumnAt,
  conditionsHold,
  describedCallKey,
  locatedExpressions,
  locatedSlots,
  precedenceOf,
  precedenceRows,
  withdrawDescribedCalls,
} from '@flowatlas/core';
// The context and the body walk, from the package neither extractor owns. This
// import is the whole of R46's answer at this end: a channel reader is not part
// of any extractor, so it names none, and the Angular reader that borrows its
// name resolution no longer inherits the Nest one through it.
import { repoSourceFiles, scopesOf, type Holder, type PassContext, type Scope } from '@flowatlas/extract-scopes';
import type { CallExpression, ClassDeclaration, MethodDeclaration, NewExpression, Node as TsNode, ParameterDeclaration } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import { brokerAdapters, createCustomBrokerAdapter, type BrokerSpec, type ConsumerPattern, type SubscriberPattern } from './adapters/index.js';
import { createStarterAdapter } from './adapters/starters.js';
import {
  hasAcknowledgement,
  functionEvidence,
  methodMatches,
  moduleFunctionEvidence,
  receiverEvidence,
  receiverIsFrom,
  replyAt,
  targetOfHandler,
  type ReceiverEvidence,
} from './call-site.js';
import { addressOf, appliesAt, collapsed, messageValue, readAddress, readWritten, type AddressedElement } from './address.js';
import { forwardedPublish, heldAt, waits } from './forwarded.js';
import { constructsFrom, dispatchRecord, functionBehind, handlerInRecord, namesHandedTo, type HandlerTarget } from './constructed.js';
import { payloadParameter, typeAtPath } from './payload.js';
import { isResolved, nameForKind, resolveChannelName, shapeChannelNames, type ChannelResolution } from './channel-name.js';
import { endpointShapingAt, isUnreadable, unreadableEndpointRow, type EndpointShaping } from './endpoint.js';
import { pairKey, readBrokerMarkers } from './markers.js';
import { rowAbout, type RowSite } from './row-site.js';
import { isStartPattern, startReader } from './starts.js';

const lineColOf = (node: TsNode): { line: number; column: number } =>
  lineAndColumnAt(node.getSourceFile(), node.getStart());

/**
 * A publish drawn at a caller of the function it is written in (P268): the
 * call that decides which member of a record the address is read from, the
 * body that call is written in, and the address read with the caller's value.
 */
interface CallerReading {
  readonly site: CallExpression;
  readonly holder: Holder;
  readonly elements: readonly AddressedElement[];
}

/** What a call is made on: the receiver of a method, or the function itself. */
const receiverOf = (call: CallExpression): TsNode => {
  const callee = call.getExpression();
  return Node.isPropertyAccessExpression(callee) ? callee.getExpression() : callee;
};

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
 * A publish read where a caller decided it (P267): the call the broker's
 * client is called with stays the call the shape is read from, and these are
 * the values read at the caller instead of at it.
 */
interface ForwardedReading {
  /** The call the publish is drawn at. */
  readonly site: CallExpression;
  readonly elements: AddressedElement[];
  readonly jobName: string | null | undefined;
  /** Every job the call's entries name, where they name several (P271). */
  readonly jobNames?: readonly string[];
  /** What the message is written as there, where it was followed out to it. */
  readonly payload: TsNode | undefined;
  /** A call on the way may run another implementation instead. */
  readonly undecided: boolean;
  /** The functions it was handed out of, innermost first. */
  readonly through: readonly string[];
  /** The class the broker's call is written in. */
  readonly writtenIn: ClassDeclaration | undefined;
}

/** Whether a description names a unit of work at all. */
const namesJobs = (pattern: CallPattern): boolean => pattern.name !== undefined || pattern.nameArg !== undefined;

/**
 * Where a publish names its units of work: the locators first, then the plain
 * argument. One place for most calls; one per entry for a call that sends a
 * list of jobs, each naming its own (P271). Only places a locator reached.
 */
const jobNamesAt = (call: CallExpression, pattern: CallPattern, context: LocatorContext): TsNode[] => {
  if (pattern.name !== undefined) {
    for (const locator of pattern.name) {
      const reached = locatedSlots(call, locator, context).flatMap((slot) => (slot !== undefined && slot.reached ? [slot.expression] : []));
      if (reached.length > 0) return reached;
    }
    return [];
  }
  const argument = pattern.nameArg === undefined ? undefined : call.getArguments()[pattern.nameArg];
  return argument === undefined ? [] : [argument];
};

/** A unit of work's name as the code writes it, or `null` where it is not written. */
const jobNameOf = (expression: TsNode): string | null => {
  const value = evaluateExpression(expression);
  return value.resolved && typeof value.value === 'string' ? value.value : null;
};

/**
 * The job a call names, and every job where its entries name several (P271):
 * `null` for a name not written where it is read.
 */
const jobsNamed = (expressions: readonly TsNode[]): { jobName: string | null; jobNames?: string[] } => {
  const names = expressions.map(jobNameOf);
  const distinct = [...new Set(names)];
  if (distinct.length === 1) return { jobName: distinct[0] ?? null };
  if (distinct.length > 1 && distinct.every((name): name is string => name !== null)) return { jobName: null, jobNames: distinct.sort() };
  return { jobName: null };
};

/** Where a publish's message is written, as its description says. */
const messageAt = (call: CallExpression, pattern: CallPattern, context: LocatorContext): TsNode | undefined => {
  if (pattern.payload !== undefined) {
    const slot = pattern.payload
      .flatMap((locator) => locatedSlots(call, locator, context))
      .find((each) => each !== undefined && each.reached);
    return slot === undefined ? undefined : messageValue(slot.expression);
  }
  return pattern.payloadArg === undefined ? undefined : call.getArguments()[pattern.payloadArg];
};

/**
 * What to do about a channel named by an environment variable.
 *
 * The variable is the one thing the code says, and the value is set by whatever
 * deploys it, so the row names the variable and where its value is: no channel
 * is drawn, because the variable's name is not the channel's.
 */
const environmentHint = (variable: string): string =>
  `The channel is the value of the environment variable ${variable}, which is set where this code is deployed and not in it. ` +
  `Where the code runs in a function whose deployment is read, the linker completes the channel from the value that function is deployed with, and this row goes; ` +
  `it stays when nothing deployed is known to run this code.`;

/** A handler as written: a method of a class, or a function of the repository's own in any spelling. */
type HandlerNode = ClassMethod | NamedFunction['declaration'];

/** The function a handler's parameters and answer are read off. */
const functionLikeOf = (handler: HandlerNode) => {
  if (Node.isMethodDeclaration(handler) || Node.isFunctionDeclaration(handler) || Node.isArrowFunction(handler) || Node.isFunctionExpression(handler)) {
    return handler;
  }
  const written = handler.getInitializer();
  return written !== undefined && (Node.isArrowFunction(written) || Node.isFunctionExpression(written)) ? written : undefined;
};

/** Every adapter that applies: the detected ones plus any described in configuration. */
export const brokerSpecsFor = (ctx: PassContext): BrokerSpec[] => {
  const detected = new Set(ctx.adapters.broker.map((adapter) => adapter.name));
  const specs = brokerAdapters.filter((spec) => detected.has(spec.name));
  const { starters } = ctx.config.adapters;
  return [
    ...specs,
    ...ctx.config.adapters.broker.custom.map(createCustomBrokerAdapter),
    ...(starters.length === 0 ? [] : [createStarterAdapter(starters)]),
  ];
};

/** How many callers a row names before it counts the rest. */
const CALLERS_NAMED = 3;

/**
 * What a row says of an address a parameter decides that is still read
 * where it is written (P268): which parameter, and the callers that leave it
 * unread - each with what it hands - or that may run another function.
 */
const decidedByHint = (
  parameter: ParameterDeclaration,
  forwarded: Forwarded,
  drawn: ReadonlySet<TsNode>,
): string => {
  const left = forwarded.calls.filter((hop) => !drawn.has(hop.site));
  const named = left
    .slice(0, CALLERS_NAMED)
    .map((hop) => `${hop.site.getSourceFile().getBaseName()}:${hop.site.getStartLineNumber()} hands ${hop.argument.getText().slice(0, 60)}`);
  const more = left.length > CALLERS_NAMED ? ` and ${left.length - CALLERS_NAMED} more` : '';
  const why = [
    ...(named.length === 0 ? [] : [`${named.join(', ')}${more}`]),
    ...(forwarded.undecided ? ['a call that may run another function hands it'] : []),
    ...(forwarded.calls.length === 0 && !forwarded.undecided ? ['nothing calls the function'] : []),
  ].join('; ');
  return `What this sends to is chosen by the parameter ${parameter.getName()}, which each caller decides; it is read where a caller writes it, and here ${why}.`;
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
  // Nothing to read with, and no deployed function whose undescribed helper
  // calls are worth naming.
  if (specs.length === 0 && !ctx.entries.some((entry) => ctx.builder.getNode(entry.node.id)?.kind === 'invoke')) return;

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
    site: RowSite,
    decidedBy?: string,
  ): void => {
    if (isResolved(resolution)) return;
    const { lookup } = resolution;
    ctx.report({
      file,
      line,
      reason: resolution.unresolved,
      hint:
        resolution.variable !== undefined
          ? environmentHint(resolution.variable)
          : decidedBy !== undefined
            ? `${decidedBy} Hand it a name the code states, or annotate ${site.named} with the channels it may use.`
            : lookup !== undefined
            ? `${resolution.text} is looked up in ${lookup.collection} by ${lookup.key}, a key worked out when the code runs, in a collection the code fills when it runs, so which channel it is is written nowhere. ` +
              `Send to an address the code or the deployment states, or annotate ${site.named} with the channels it may use.`
            : resolution.why !== undefined
            ? `${resolution.why} Annotate ${site.named} with the channel it uses.`
            : `The channel name cannot be read here. Annotate ${site.named} with the channel it uses.`,
      ...rowAbout(site, resolution.text),
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
    site: RowSite,
  ): void => {
    if (isUnreadable(shaping)) ctx.report(unreadableEndpointRow(shaping, spec, file, line, site));
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
   * The callers a publish's queue is decided at, each read, where the queue is
   * a parameter of the function the broker's call is written in or a field its
   * instance was built with (P267).
   *
   * Only a one-part address that could not be read where it is written: a
   * queue read here is drawn here, as it always was. The job and the message
   * are followed out along the same calls, so each reading is one caller's.
   * Absent where there is nothing to follow.
   */
  const forwardedOut = (
    call: CallExpression,
    pattern: CallPattern,
    spec: BrokerSpec,
    elements: readonly AddressedElement[],
    context: LocatorContext,
  ): { readings: ForwardedReading[]; here: boolean } | undefined => {
    // The job is followed out with the queue where one place names it (P271).
    const namedAt = jobNamesAt(call, pattern, context);
    const [first] = namedAt;
    const named = first !== undefined && namedAt.every((each) => each.getText() === first.getText()) ? first : undefined;
    const carried = messageAt(call, pattern, context);
    const job = named === undefined ? undefined : heldAt(named);
    const message = carried === undefined ? undefined : heldAt(carried);
    const [only] = elements;
    const [part, ...more] = addressOf(pattern);
    const address =
      elements.length !== 1 || only === undefined || isResolved(only.resolution) || part === undefined || more.length > 0 || 'literal' in part
        ? undefined
        : locatedExpressions(call, part.at, context).map(heldAt).find(waits);
    if (address === undefined) {
      // The queue read here and the job decided further out (P271): drawn
      // where each caller names the job, on the queue read here.
      if (job === undefined || !waits(job) || elements.length === 0 || !elements.every((element) => isResolved(element.resolution))) return undefined;
      const walked = forwardedPublish([job, message], ctx.di);
      const readings = walked.sites.map((site): ForwardedReading => {
        const [decided, handed] = site.values;
        return {
          site: site.site,
          elements: [...elements],
          jobName: decided?.kind === 'written' ? jobNameOf(decided.expression) : null,
          payload: handed === undefined || handed.kind === 'unread' ? undefined : messageValue(handed.expression),
          undecided: site.undecided,
          through: site.through,
          writtenIn: undefined,
        };
      });
      return { readings, here: walked.here };
    }
    const walked = forwardedPublish([address, job, message], ctx.di, 2);
    const readings = walked.sites.map((site): ForwardedReading => {
      const [queue, job, message] = site.values;
      const element: AddressedElement =
        queue?.kind === 'written' && part !== undefined
          ? readWritten(queue.expression, part, ctx.config)
          : {
              resolution: {
                unresolved: 'channel-dynamic',
                text: (queue?.expression ?? site.site).getText().slice(0, 60),
                why:
                  queue?.kind === 'unread'
                    ? queue.why
                    : `The queue is handed in from further out than ${site.through.length} calls, which is as far as it is followed.`,
              },
            };
      return {
        site: site.site,
        elements: [{ ...element, resolution: nameForKind(element.resolution, spec.channelKind) }],
        ...(!namesJobs(pattern)
          ? { jobName: undefined }
          : named === undefined && namedAt.length > 0
            ? jobsNamed(namedAt)
            : { jobName: job?.kind === 'written' ? jobNameOf(job.expression) : null }),
        payload: message === undefined || message.kind === 'unread' ? undefined : messageValue(message.expression),
        undecided: site.undecided,
        through: site.through,
        writtenIn: undefined,
      };
    });
    return { readings, here: walked.here };
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
    caller?: CallerReading,
    from?: ForwardedReading,
  ): boolean => {
    const { id: methodId, file } = caller?.holder ?? holder;
    const args = call.getArguments();
    const { line, column } = lineColOf(caller?.site ?? from?.site ?? call);
    const callee = call.getExpression();
    const receiver = Node.isPropertyAccessExpression(callee) ? callee.getExpression() : callee;
    // The class the broker's call is written in, which says what its own
    // receiver is; `owner` is the one the publish is drawn in.
    const writtenIn = from === undefined ? owner : from.writtenIn;
    const context = contextOf(receiver, writtenIn);
    const fallback =
      // A receiver that is the channel and names nothing readable is best shown
      // as the receiver: `queue.add(job)` says nothing, and `queue` is the thing
      // a reader has to go and look at.
      pattern.channel !== undefined && pattern.address === undefined
        ? receiver.getText()
        : call.getText().slice(0, 60);

    // One element per address the call is sent to: one for an ordinary publish,
    // one per entry for a call that sends a list of them.
    // A record read where a queue is named is no queue (R181).
    const elements = (
      caller?.elements ?? from?.elements ?? readAddress(call, addressOf(pattern), pattern.payload, context, ctx.config, fallback)
    ).map((element) => ({ ...element, resolution: nameForKind(element.resolution, spec.channelKind) }));

    // A queue its callers decide is drawn where each of them decides it, and
    // here only where nothing calls this or the walk out stopped short (P267).
    if (from === undefined && caller === undefined) {
      const forwarded = forwardedOut(call, pattern, spec, elements, context);
      if (forwarded !== undefined) {
        for (const reading of forwarded.readings) {
          const scope = holderAt(reading.site);
          if (scope === undefined) continue;
          emitProducer(call, pattern, spec, scope, scope.owner, evidence, undefined, { ...reading, writtenIn: owner });
        }
        if (!forwarded.here) return true;
      }
    }

    // An address read from a record a parameter chooses, or that is one, is
    // decided by each caller of the function the call is written in (P268):
    // drawn there, read with the parameter bound to what that caller hands
    // it, wherever every caller reads it in full.
    const [selector, ...others] = new Set(elements.flatMap((element) => (element.selector === undefined ? [] : [element.selector])));
    /** What the row says where the callers leave the address unread. */
    let decidedBy: string | undefined;
    if (caller === undefined && from === undefined && selector !== undefined && others.length === 0) {
      // A caller that reads no more than the call does decides nothing anyone
      // can name: the call keeps its own producer and its row, as it does
      // for a caller that may run another function (R158).
      const here: { holder: Holder; elements: readonly AddressedElement[] } = { holder, elements };
      const sureness = (reading: typeof here): number =>
        reading === here ? 0 : reading.elements.every((element) => isResolved(element.resolution)) ? 1 : -1;
      const forwarded = forwardedFrom(selector);
      const forwarding = forwardNoWorse<{ holder: Holder; elements: readonly AddressedElement[] }>(forwarded, {
        here,
        at: (hop) => {
          const owned = holderAt(hop.site);
          if (owned === undefined) return undefined;
          const bound = new Map<TsNode, TsNode>([[selector, hop.argument]]);
          return {
            holder: owned,
            elements: readAddress(call, addressOf(pattern), pattern.payload, { ...context, bound }, ctx.config, fallback),
          };
        },
        sureness,
      });
      for (const { site, reading } of forwarding.callers) {
        if (!Node.isCallExpression(site)) continue;
        emitProducer(call, pattern, spec, holder, owner, evidence, { site, holder: reading.holder, elements: reading.elements });
      }
      if (!forwarding.here) return true;
      decidedBy = decidedByHint(selector, forwarded, new Set(forwarding.callers.map((each) => each.site)));
    }

    // Values the description keeps as written beside the address: the key a
    // write to a bucket names, which a notification of the bucket filters on
    // (P52). A value written and not read is recorded as no values, which a
    // reader further on says; a field not written at all is left out, so the
    // two stay apart: a delete naming a version nobody can read still names one
    // (P56). Not read for a publish drawn at a caller: they are written where
    // the broker's call is, about values that caller does not decide.
    const recordedRead = Object.entries(from === undefined ? (pattern.recorded ?? {}) : {}).flatMap(([name, at]) => {
      const elements = readAddress(call, [{ at }], undefined, context, ctx.config, '');
      const read = collapsed(elements);
      if (isResolved(read)) return [[name, [...read.names]] as const];
      return elements.some((element) => element.written !== undefined) ? [[name, [] as string[]] as const] : [];
    });
    const recorded = recordedRead.length === 0 ? undefined : Object.fromEntries(recordedRead);

    const jobNameArgs = jobNamesAt(call, pattern, context);
    const jobs =
      from !== undefined
        ? { jobName: from.jobName, ...(from.jobNames === undefined ? {} : { jobNames: [...from.jobNames] }) }
        : jobNameArgs.length === 0
          ? { jobName: pattern.name === undefined ? undefined : null }
          : jobsNamed(jobNameArgs);
    const { jobName } = jobs;

    const exchangeArg = from !== undefined || pattern.exchangeArg === undefined ? undefined : args[pattern.exchangeArg];
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
    // A publish drawn at a caller carries what that caller hands in, where the
    // message was followed out to it, and what the broker's call declares where
    // it was not.
    const forwardedPayload =
      from?.payload === undefined ? undefined : ctx.types.collectType(from.payload.getType(), from.payload);
    const shared =
      forwardedPayload ?? (pattern.payload === undefined ? argumentPayload() : undefined);
    const payloadOf = (element: AddressedElement): string | undefined =>
      forwardedPayload !== undefined || pattern.payload === undefined
        ? shared
        : element.payload === undefined
          ? undefined
          : ctx.types.collectType(element.payload.getType(), element.payload);

    // The transport has the last word on the name the call wrote: an endpoint
    // the class declares is part of it, and a name the transport keeps for its
    // own signalling is not a channel at all.
    const shaping = endpointShapingAt(spec, writtenIn, receiver);
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
    // shape a reader of the deployment completes it in: the parts it has, the
    // variable standing in for each part it has not, and the message it carries
    // there, so the channel it turns out to be is compared like any other.
    const awaiting: AwaitedAddress[] = unread.flatMap((element) => {
      if (element.awaiting === undefined) return [];
      const payload = payloadOf(element);
      return [{ parts: element.awaiting, ...(payload === undefined ? {} : { payload }) }];
    });
    // A receiver known only from what the source says it is constructed from
    // is what the author meant rather than what a compiler checked.
    // So is one drawn at a caller through a call that may run another
    // implementation of the method instead (R158).
    const confidence = evidence === 'checked' && from?.undecided !== true ? 'static' : 'heuristic';
    // The label names every channel the address reaches, which is how the
    // marker path already spells a producer of several (R38). `name` is the
    // representative pattern and stays the dedupe key, but showing it alone
    // printed `order:*:*` for a producer that knows the three names behind it —
    // the wildcard the fold exists to remove, still on the screen (R44).
    const reaches = names.length > 0 ? names.join(', ') : undefined;
    // The body is now known to hold a publish, which is the point at which it
    // earns a node: `ensure` is deferred precisely so that the thousands of
    // functions in a repository that publish nothing stay out of the graph.
    (caller?.holder ?? holder).ensure();
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
        ...(jobs.jobNames === undefined ? {} : { jobNames: jobs.jobNames }),
        ...(exchange === undefined ? {} : { exchange }),
        ...(recorded === undefined ? {} : { [RECORDED_META]: recorded }),
        ...(pattern.guessed === undefined ? {} : { [GUESSED_META]: pattern.guessed }),
        // The kind of channel it will be, for whoever completes the address:
        // only the transport knows it, and the deployment does not say.
        // How far the call can be trusted once the address is complete, which
        // its edge cannot say while there is no channel to put it on.
        ...(awaiting.length === 0 ? {} : { [AWAITING_META]: awaiting, channelKind: spec.channelKind, confidence }),
        // A write only some deployment makes a publish: kept or dropped by the linker.
        ...(pattern.whereDeclared === true ? { [WHERE_DECLARED_META]: true } : {}),
        // How a loop around it is read (P89): a batch, or a send with none.
        ...(pattern.batch === true ? { batch: true } : {}),
        ...(pattern.perItem === true ? { perItem: true } : {}),
        // The functions of the repository's own it was handed out of (P267).
        ...(from === undefined ? {} : { through: [...from.through] }),
        // Which rule of the project's patterns drew it, when one did (P121).
        ...(pattern.describedBy === undefined ? {} : { describedBy: pattern.describedBy }),
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

    // The row sits on the producer, which a walk through the body passes, and
    // names the body by the label the graph gives it: asking the node rather
    // than spelling `Class.method` again is what lets a function be named as a
    // function rather than as a method of nothing.
    const site: RowSite = { named: ctx.builder.getNode(methodId)?.label ?? methodId, node: producerId };
    if (!readable) {
      if (channelName === null) reportEndpoint(shaping, spec, file, line, site);
    } else {
      // One row per thing to fix: two entries refused for the same reason at
      // the same expression are one row.
      const reported = new Set<string>();
      for (const element of unread) {
        const key = JSON.stringify(element.resolution);
        if (reported.has(key)) continue;
        reported.add(key);
        reportChannel(element.resolution, file, line, site, decidedBy);
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
        confidence: pattern.guessed === undefined ? confidence : 'heuristic',
        file,
        line,
        ...(pattern.guessed === undefined ? {} : { meta: { because: [pattern.guessed] } }),
        ...(payloadType === undefined ? {} : { params: [payloadType] }),
        ...(replyType === undefined ? {} : { returns: replyType }),
      });
    }
    // A call described as carrying nothing - an empty `payload` - has nothing to report.
    if (!carriesAny && pattern.payload?.length !== 0) {
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
    channelKind: string,
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
      resolution: nameForKind(
        channelAt(
          site,
          { channel: pattern.channel, channelArg: -1 },
          {},
          ctx.config,
          // What a reader has to go and look at is the decorator that was supposed
          // to name the channel, not the method under it.
          site.getText().slice(0, 60),
        ),
        channelKind,
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
    const { resolution, jobName } = consumerChannel(pattern, method, owner, spec.channelKind);
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
        ...(pattern.describedBy === undefined ? {} : { describedBy: pattern.describedBy }),
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
      if (isUnreadable(shaping)) reportEndpoint(shaping, spec, file, line, { named: symbol });
      else if (!entryReaderRefused(file, line, symbol)) reportChannel(resolution, file, line, { named: symbol });
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
    handler: HandlerNode,
  ): { params: TypeRef[]; returns: TypeRef } | undefined => {
    const fn = functionLikeOf(handler);
    return fn === undefined ? undefined : ctx.types.collectSignature(fn);
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
    handlerMethod: HandlerNode,
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

    // Which descriptions each call is read by, settled before any is drawn
    // (P121): every written one that matches, as before; a pattern only where
    // nothing written does, and only where it is the one pattern that does.
    // Asked first and drawn in the order below, so the channels keep the
    // places they were first seen at.
    const readBy = new Map<CallExpression, ReadonlySet<SubscriberPattern>>();
    /** Subscriptions whose receiver is known only from what the source states it is. */
    const stated = new Set<CallExpression>();
    // A worker made by a construction is read on its own, below (P271).
    const subscribing = specs.flatMap((spec) =>
      (spec.subscriberPatterns ?? []).filter((pattern) => pattern.constructs === undefined).map((pattern) => ({ spec, pattern })),
    );
    /**
     * How a subscription's receiver is the one a pattern names. A library's
     * pattern asks the checker alone, as it always has; a description the
     * project wrote - which names a type and no package - is also matched on
     * what the source states the receiver is, the way a described publish is,
     * so a bus from a package nobody installed is read at both ends (P121).
     * So is a library's pattern whose receiver is the channel itself - a
     * queue's `process` - as the publish on the same receiver is (P271).
     */
    const subscribedOn = (receiver: TsNode, pattern: SubscriberPattern): ReceiverEvidence | undefined =>
      pattern.receiverPackages === undefined || pattern.channel !== undefined
        ? receiverEvidence(receiver, pattern)
        : receiverIsFrom(receiver, pattern)
          ? 'checked'
          : undefined;
    for (const call of calls) {
      const callee = call.getExpression();
      if (!Node.isPropertyAccessExpression(callee)) continue;
      const evidence = new Map<SubscriberPattern, ReceiverEvidence>();
      const matches = subscribing.filter(({ pattern }) => {
        if (!methodMatches(callee.getName(), pattern.method) || !conditionsHold(call, pattern.where)) return false;
        const found = subscribedOn(callee.getExpression(), pattern);
        if (found !== undefined) evidence.set(pattern, found);
        return found !== undefined;
      });
      if (matches.some(({ pattern }) => evidence.get(pattern) === 'stated')) stated.add(call);
      if (matches.length === 0) continue;
      const choice = precedenceOf(matches, (match) => match.pattern.describedBy);
      const at = { file, line: lineColOf(call).line, symbol: `${className}.${method.getName()} -> ${callee.getText().slice(0, 60)}` };
      for (const row of precedenceRows(choice, at, choice.chosen[0]?.spec.name)) ctx.report(row);
      readBy.set(call, new Set(choice.chosen.map((match) => match.pattern)));
    }

    for (const spec of specs) {
      for (const pattern of spec.subscriberPatterns ?? []) {
        for (const call of calls) {
          if (readBy.get(call)?.has(pattern) !== true) continue;
          const callee = call.getExpression();
          if (!Node.isPropertyAccessExpression(callee)) continue;
          const spelling = callee.getName();

          const args = call.getArguments();
          const resolution = nameForKind(
            channelAt(call, pattern, contextOf(callee.getExpression(), owner), ctx.config, call.getText().slice(0, 60)),
            spec.channelKind,
          );
          const { line } = lineColOf(call);
          // Read as a subscription, so the row saying its receiver could not
          // be followed goes (P121), as a described publish's does.
          described.add(describedCallKey(file, line, call));
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
          // Counted from the end where negative: the handler is last where the
          // arguments before it are optional (P271).
          let handler = pattern.handlerArg === undefined ? undefined : args.at(pattern.handlerArg);
          // The one job it takes, where the call names one (P271).
          const named = pattern.nameArg === undefined || args.length < 2 ? undefined : args[pattern.nameArg];
          const jobRead = named === undefined ? undefined : evaluateExpression(named);
          const jobName = jobRead?.resolved === true && typeof jobRead.value === 'string' ? jobRead.value : undefined;
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
            meta: {
              kind: pattern.kind,
              adapter: spec.name,
              decorator: spelling,
              entryId,
              ...(jobName === undefined ? {} : { jobName }),
              ...(pattern.describedBy === undefined ? {} : { describedBy: pattern.describedBy }),
            },
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
            if (isUnreadable(shaping)) reportEndpoint(shaping, spec, file, line, { named: symbol });
            else reportChannel(resolution, file, line, { named: symbol });
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
              // A receiver known only from what the source states is what the
              // author meant rather than what a compiler checked.
              confidence: stated.has(call) ? 'heuristic' : 'static',
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
      pattern.module !== undefined
        ? moduleFunctionEvidence(callee, pattern.module, pattern.method)
        : pattern.calledAs === 'function'
        ? functionEvidence(callee, pattern.method)
        : Node.isPropertyAccessExpression(callee) && methodMatches(callee.getName(), pattern.method)
          ? receiverEvidence(callee.getExpression(), pattern)
          : undefined;
    return evidence !== undefined && appliesAt(call, pattern) && conditionsHold(call, pattern.where) ? evidence : undefined;
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

    /** Whether a description marks this handler, its required values written on the decorator. */
    const marks = (pattern: ConsumerPattern): boolean => {
      if (pattern.classDecorator !== undefined && pattern.nameArgIndex === undefined) {
        // A worker class handles its queue through one named method.
        if (method.getName() !== 'process') return false;
        const decorator = getDecorator(owner, pattern.classDecorator);
        return decorator !== undefined && conditionsHold(decorator, pattern.where);
      }
      if (findDecorators(method, { names: [pattern.decorator] }).length === 0) return false;
      const decorator = pattern.where === undefined ? undefined : getDecorator(method, pattern.decorator);
      return pattern.where === undefined || (decorator !== undefined && conditionsHold(decorator, pattern.where));
    };
    const matches = specs.flatMap((spec) => spec.consumerPatterns.filter(marks).map((pattern) => ({ spec, pattern })));
    if (matches.length === 0) return;
    // A written description wins over a pattern, and two patterns on one
    // handler are ambiguous (P121); written ones are all read, as before.
    const choice = precedenceOf(matches, (match) => match.pattern.describedBy);
    const at = { file, line: lineColOf(method).line, symbol: `${className}.${method.getName()}` };
    for (const row of precedenceRows(choice, at, choice.chosen[0]?.spec.name)) ctx.report(row);
    for (const { spec, pattern } of choice.chosen) emitConsumer(method, owner, pattern, spec, file, className);
  };

  // A publish is read wherever it is written: a method, a module-level
  // function, a member of an object of functions, a handler written in the
  // registration. The walk is the data-layer reader's walk too, taken from
  // `@flowatlas/extract-scopes` rather than copied here, because two copies of
  // the judgement "what counts as a body" diverge the first time one of them is
  // reconsidered (R54).
  const scopes = [...scopesOf(ctx)];
  const bodies = new Map<TsNode, Scope>(scopes.map((scope) => [scope.body, scope]));
  /** The body a call is written in, for a start whose name its caller decides. */
  const holderAt = (site: TsNode): Scope | undefined => {
    for (let at: TsNode | undefined = site; at !== undefined; at = at.getParent()) {
      const scope = bodies.get(at);
      if (scope !== undefined) return scope;
    }
    return undefined;
  };
  const starts = startReader(ctx, holderAt);

  /** What a handler found for a worker is, as the graph names it. */
  const drawnHandler = (target: HandlerTarget): { id: string; label: string; file: string; node: HandlerNode; ensure: () => void } | undefined => {
    if (target.kind === 'method') {
      const id = ctx.methodIdOf(target.method);
      if (id === undefined) return undefined;
      const owner = target.method.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
      const className = owner === undefined ? '?' : (ctx.classes.get(owner)?.name ?? owner.getName() ?? '?');
      return {
        id,
        label: `${className}.${target.method.getName()}`,
        file: ctx.fileOf(target.method),
        node: target.method,
        ensure: () => {
          ctx.ensureMethodNode(target.method);
        },
      };
    }
    return {
      id: ctx.functionIdOf(target.fn),
      label: target.fn.name,
      file: ctx.fileOf(target.fn.declaration),
      node: target.fn.declaration,
      ensure: () => {
        ctx.ensureFunctionNode(target.fn);
      },
    };
  };

  /**
   * A worker started by a construction (P271): `new Worker(name, processor)`,
   * read once per queue its name stands for - each element of a loop it is
   * made in, each caller of the function it is made in - with the handler
   * the processor runs for that queue: the member of the record it looks its
   * handler up in by the queue's name, or the processor itself.
   */
  const emitConstructed = (construction: NewExpression, spec: BrokerSpec, pattern: SubscriberPattern): void => {
    const args = construction.getArguments();
    const nameArg = args[pattern.channelArg];
    if (nameArg === undefined) return;
    const processor = pattern.handlerArg === undefined ? undefined : args.at(pattern.handlerArg);
    const owner = construction.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
    const around = holderAt(construction);
    const file = ctx.fileOf(construction);
    const { line } = lineColOf(construction);
    const spelling = `new ${pattern.constructs ?? pattern.channelArg}`;
    const symbolHere = `${ctx.builder.getNode(around?.id ?? '')?.label ?? file} -> ${spelling}`;
    const record = dispatchRecord(nameArg, processor);

    /** The processor itself as a handler, where it can be named. */
    let unfollowed = false;
    const processorTarget = (bound: Parameters<typeof functionBehind>[2]): HandlerTarget | undefined => {
      if (processor === undefined) return undefined;
      const named = functionBehind(processor, owner, bound);
      if (named !== undefined) return named;
      const written = processor;
      if (Node.isArrowFunction(written) || Node.isFunctionExpression(written)) {
        const placed = bodies.get(written.getBody());
        if (placed?.fn !== undefined) return { kind: 'function', fn: placed.fn };
        const delegated = owner === undefined ? undefined : targetOfHandler(written, owner);
        if (delegated !== undefined) return { kind: 'method', method: delegated };
      }
      unfollowed = true;
      // The body the worker is made in, as the subscriptions do.
      if (around?.method !== undefined) return { kind: 'method', method: around.method };
      if (around?.fn !== undefined) return { kind: 'function', fn: around.fn };
      return undefined;
    };

    interface Group {
      readonly target: HandlerTarget;
      readonly names: Set<string>;
      undecided: boolean;
      readonly through: Set<string>;
    }
    const groups = new Map<string, Group>();
    const unread: { resolution: ChannelResolution; target: HandlerTarget | undefined }[] = [];
    for (const reading of namesHandedTo(nameArg, ctx.config)) {
      const resolution = nameForKind(reading.resolution, spec.channelKind);
      const names = isResolved(resolution) ? shapeChannelNames(resolution.names, { reserved: spec.reservedChannels ?? [] }) : [];
      const [only, ...more] = names;
      const looked = record !== undefined && only !== undefined && more.length === 0 ? handlerInRecord(record, only, owner) : undefined;
      const target = looked ?? processorTarget(reading.bound);
      if (!isResolved(resolution)) {
        unread.push({ resolution, target });
        continue;
      }
      if (target === undefined) continue;
      const drawn = drawnHandler(target);
      if (drawn === undefined) continue;
      const group = groups.get(drawn.id) ?? { target, names: new Set<string>(), undecided: false, through: new Set<string>() };
      for (const name of names) group.names.add(name);
      group.undecided ||= reading.undecided;
      for (const each of reading.through) group.through.add(each);
      groups.set(drawn.id, group);
    }
    if (unfollowed && processor !== undefined) {
      ctx.report({
        file,
        line,
        reason: 'consumer-handler-unresolved',
        hint: 'The processor does more than delegate, so the chain stops at the body the worker is made in.',
        symbol: symbolHere,
      });
    }

    /** One consumer per handler, joined to every queue it takes. */
    const draw = (target: HandlerTarget, names: readonly string[], undecided: boolean, through: readonly string[]): string | undefined => {
      const drawn = drawnHandler(target);
      if (drawn === undefined) return undefined;
      drawn.ensure();
      const fnNode = functionLikeOf(drawn.node);
      const first = fnNode?.getParameters()[0];
      const carried = first === undefined ? undefined : typeAtPath(first.getType(), pattern.payloadPath ?? [], first);
      const body = carried === undefined || first === undefined ? undefined : ctx.types.collectType(carried, first);
      const entryId = names.length === 0 ? null : entryOfHandler(names, pattern.kind, drawn.node, drawn.id, spec, file, line, body);
      // One consumer per handler per worker: the same function run by two
      // workers is two subscriptions, each drawn where it is made.
      const consumerId = `consumer:${makeSymbolId(ctx.repo, drawn.file, drawn.label)}@${file}:${line}`;
      ctx.builder.addNode({
        id: consumerId,
        type: 'consumer',
        label: drawn.label,
        repo: ctx.repo,
        file,
        line,
        kind: pattern.kind,
        meta: {
          kind: pattern.kind,
          adapter: spec.name,
          decorator: spelling,
          entryId,
          ...(through.length === 0 ? {} : { through: [...through] }),
          ...(pattern.describedBy === undefined ? {} : { describedBy: pattern.describedBy }),
        },
      });
      ctx.builder.addEdge({ from: consumerId, to: drawn.id, type: 'handles', confidence: 'static', file, line });
      for (const name of names) {
        const channel = channelNodeOf(name, spec, file, line);
        alreadyStatic.add(pairKey(drawn.id, name));
        ctx.builder.addEdge({
          from: channel.id,
          to: consumerId,
          type: 'consumes',
          // Read through a call that may run another function instead (R158).
          confidence: undecided ? 'heuristic' : 'static',
          file,
          line,
        });
      }
      return drawn.label;
    };
    for (const group of groups.values()) draw(group.target, [...group.names].sort(), group.undecided, [...group.through]);
    const reported = new Set<string>();
    for (const { resolution, target } of unread) {
      const key = JSON.stringify(resolution);
      if (reported.has(key)) continue;
      reported.add(key);
      const label = target === undefined ? undefined : draw(target, [], false, []);
      reportChannel(resolution, file, line, { named: label ?? symbolHere });
    }
  };

  /** Every construction a description says starts a worker, wherever it is written. */
  const constructing = specs.flatMap((spec) =>
    (spec.subscriberPatterns ?? []).filter((pattern) => pattern.constructs !== undefined).map((pattern) => ({ spec, pattern })),
  );
  const readConstructions = (): void => {
    if (constructing.length === 0) return;
    for (const source of repoSourceFiles(ctx)) {
      for (const construction of source.getDescendantsOfKind(SyntaxKind.NewExpression)) {
        const match = constructing.find(({ pattern }) =>
          constructsFrom(construction, pattern.constructs as string, pattern.receiverPackages ?? []),
        );
        if (match !== undefined) emitConstructed(construction, match.spec, match.pattern);
      }
    }
  };
  /** The calls a description matched, as the calls reader names a call it could not follow. */
  const described = new Set<string>();
  /** Every description of a publish or a start, in the order they are tried. */
  const producing = specs.flatMap((spec) => spec.producerPatterns.map((pattern) => ({ spec, pattern })));

  for (const scope of scopes) {
    forEachCall(scope.body, (call) => {
      const expression = call as unknown as CallExpression;
      // The first description that matches is read, as it always was; a
      // compiled pattern only where nothing written matches, and only where
      // it is the one pattern that does (P121). Every match is asked for only
      // once one is found, so a call nothing describes costs what it did.
      const first = producing.findIndex(({ pattern }) => evidenceFor(pattern, expression) !== undefined);
      if (first < 0) {
        starts.notice(expression, scope);
        return;
      }
      const matches = producing.slice(first).filter(({ pattern }, index) => index === 0 || evidenceFor(pattern, expression) !== undefined);
      const choice = precedenceOf(matches, (match) => match.pattern.describedBy);
      const line = lineColOf(expression).line;
      const symbol = `${ctx.builder.getNode(scope.id)?.label ?? scope.id} -> ${expression.getExpression().getText().slice(0, 60)}`;
      for (const row of precedenceRows(choice, { file: scope.file, line, symbol }, choice.chosen[0]?.spec.name)) ctx.report(row);
      const chosen = choice.chosen[0];
      if (chosen === undefined) return;
      const { spec, pattern } = chosen;
      const evidence = evidenceFor(pattern, expression) as NonNullable<ReturnType<typeof evidenceFor>>;
      described.add(describedCallKey(scope.file, line, expression));
      // A start is read through the same pattern and address, and names an
      // entry rather than a channel.
      if (isStartPattern(pattern)) starts.read(expression, pattern, spec, scope, contextOf(receiverOf(expression), scope.owner), evidence);
      else emitProducer(expression, pattern, spec, scope, scope.owner, evidence);
    });

    readReceiving(scope);
  }

  // A call whose receiver has no type is a place static reading cannot see,
  // until a description says what it is: then it is read, as a publish or a
  // start, and the row saying it could not be goes (R173).
  // Workers made by a construction, after every body, so a channel keeps the
  // place it was first seen at (P271).
  readConstructions();

  withdrawDescribedCalls(ctx.builder, described);

  readBrokerMarkers(ctx, specs[0] ?? brokerAdapters[0], alreadyStatic);
};

export const brokersPass: ExtractorPass<PassContext> = definePass('brokers', extractBrokers);
