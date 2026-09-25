/**
 * What to do about each thing the tool could not read.
 *
 * Every extractor already writes a hint beside the row it could not resolve,
 * and that hint wins: it was written where the code was being read, by whoever
 * knew why the reading stopped. This catalogue is the second line — the sentence
 * for a row whose author wrote none, and the reason a row of an unknown kind is
 * still printed with advice rather than dropped.
 *
 * It is also the first line in one narrow case. An address built at run time is
 * reported while one repository is being read, when nothing yet knows which
 * service answers it; the linker learns that afterwards. Where the joined graph
 * can name the service and the route, it says so, because `@CallsService('orders',
 * 'POST /orders')` is an instruction and "annotate the call" is not.
 */
import { wasRead, type GraphNode, type Unresolved } from '@flowatlas/core';
import { UNCHECKED_HINTS } from '@flowatlas/contracts';

/** What the joined graph knows about the row that reading one repository did not. */
export interface HintContext {
  /** The node the row names, or the one at the place it points at. */
  node?: GraphNode;
  /** True when that call did reach a route in the end, annotation or not. */
  joined?: boolean;
  /**
   * The requests written in the same method: how many an annotation asserts,
   * and how many were not read.
   *
   * An annotation does not repair the request it sits above; it adds one of its
   * own. So what a row about an unread request should say depends on whether
   * the annotations on that method can only be about it (R39).
   */
  requests?: { asserted: number; unread: number };
}

export type HintTemplate = (row: Unresolved, context: HintContext) => string;

const meta = (context: HintContext, key: string): string | undefined => {
  const value = context.node?.meta?.[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
};

const named = (row: Unresolved): string => row.symbol ?? 'the call';

/** A row with nothing of any one place on it, for asking a template the general question. */
const ANONYMOUS = { reason: '', file: '', line: 0 } as unknown as Unresolved;

/**
 * The annotation that would answer this, spelled out as far as it can be.
 *
 * A row saying the address is built at run time tells a reader to annotate the
 * call and not how, because when it was written — one repository at a time —
 * nothing yet knew which service answers. The joined graph does, sometimes, and
 * where it does not, the shape of the annotation is still worth putting in
 * front of somebody rather than making them go and look it up.
 *
 * A path is only ever quoted when it was read in full. Half a path inside an
 * annotation is a route that reaches nothing, which is the very failure this
 * command exists to catch.
 */
const readablePath = (context: HintContext): string | undefined => {
  const path = meta(context, 'path');
  return path !== undefined && wasRead(path) ? path : undefined;
};

const callsService = (context: HintContext): string | undefined => {
  // Nothing here that the extractor did not already know, so stand aside and
  // let what it wrote be printed. A sharpener that answers anyway would replace
  // a sentence naming the real target with one full of placeholders.
  if (context.joined !== true && context.node === undefined) return undefined;
  // The row was written while one repository was being read, before anything
  // knew whether an annotation elsewhere answers it. If one does, the row is a
  // record of what could not be read rather than something left to do, and
  // saying "annotate this" again would send somebody to a line already annotated.
  if (context.joined === true) {
    const service = meta(context, 'targetService');
    return (
      'The address is built at run time, and an annotation on this method already says where it goes' +
      `${service === undefined ? '' : ` — ${service}`}. Nothing to do here.`
    );
  }
  const service = meta(context, 'targetService') ?? '<service>';
  const path = readablePath(context);
  const method = path === undefined ? '<METHOD>' : (meta(context, 'method') ?? 'GET').toUpperCase();
  return (
    'The address is built at run time. Annotate the calling method with ' +
    `@CallsService('${service}', '${method} ${path ?? '/<path>'}') to say where it goes.`
  );
};

/** The same for a request made in a browser, where the annotation is JSDoc. */
const flowatlasCalls = (context: HintContext): string | undefined => {
  if (context.node === undefined) return undefined;
  const service = meta(context, 'targetService');
  const path = readablePath(context);
  // The verb is usually readable even when the path is not — the call is
  // `http.get(...)` whatever it is given — and an annotation with the verb
  // already in it is less to work out than one with a placeholder.
  const verb = (meta(context, 'method') ?? '').toUpperCase();
  const method = verb === '' ? '<METHOD>' : verb;
  const named = service === undefined ? '' : ` ${service} is what answers it.`;
  const requests = context.requests;

  // The annotation is there and can be about nothing else, so the row is a
  // record of what could not be read rather than something left to do.
  if (requests !== undefined && coversEveryUnread(requests)) {
    return (
      'The address is built at run time, and an annotation on this method already says where it ' +
      'goes. Nothing to do here.'
    );
  }

  // Annotated, and not enough to go round. Saying "annotate this" again would
  // send somebody to a line that is annotated; saying nothing would be the
  // silence this was raised about. The way out is one annotation per request.
  if (requests !== undefined && requests.asserted > 0) {
    return (
      `This method carries ${requests.asserted} annotation${requests.asserted === 1 ? '' : 's'} ` +
      `and ${requests.unread} requests whose address is built at run time, so nothing here says ` +
      'which annotation describes which. Write one per request, or move each request into its ' +
      'own method.'
    );
  }

  return (
    `The address is built at run time.${named} Annotate the method with ` +
    `/** @flowatlas-calls ${method} ${path ?? '/<path>'} */.`
  );
};

/** As much of the graph as deciding "was this annotated?" needs to ask. */
export interface MarkerGraph {
  edgesFrom(id: string, types?: readonly string[]): ReadonlyArray<{ to: string; confidence: string }>;
  edgesTo(id: string, types?: readonly string[]): ReadonlyArray<{ from: string; confidence: string }>;
  node?(id: string): GraphNode | undefined;
}

/** Every request written in one method, as the graph holds them. */
const requestsIn = (
  owner: string,
  graph: MarkerGraph,
): { asserted: number; unread: number } => {
  let asserted = 0;
  let unread = 0;
  for (const edge of graph.edgesFrom(owner, ['calls'])) {
    const call = graph.node?.(edge.to);
    if (call === undefined || call.type !== 'ui_api_call') continue;
    const joined = graph.edgesFrom(call.id, ['hits']).length > 0;
    // An annotation that named a route nothing serves has not answered
    // anything: the reader still has something to fix, and the marker checks
    // say what. Only one that reached a route counts.
    if (call.meta?.['via'] === 'marker') {
      if (joined) asserted += 1;
    } else if (!joined) unread += 1;
  }
  return { asserted, unread };
};

/**
 * How a method's requests stand, for a row about one of them.
 *
 * Exported because the row's sentence needs the same two numbers the demotion
 * does: a method with two unreadable requests and one annotation keeps both
 * rows, and has to be told why (R39).
 */
/**
 * Whether a method's annotations can account for every request it could not read.
 *
 * One predicate, because two things ask it: the sentence a row carries and
 * whether the row counts as work. Written twice they drift, and the drift is a
 * row saying "nothing to do here" while still being counted among the things
 * to do — the exact fault R36 and R37 were raised about.
 */
export const coversEveryUnread = (found: { asserted: number; unread: number }): boolean =>
  found.asserted > 0 && found.asserted >= found.unread;

export const requestsAround = (
  callId: string,
  graph: MarkerGraph,
): { asserted: number; unread: number } | undefined => {
  const owner = graph.edgesTo(callId, ['calls'])[0]?.from;
  return owner === undefined ? undefined : requestsIn(owner, graph);
};

/** What the graph looks like once the annotation a row asks for has worked. */
type AnswerTest = (id: string, graph: MarkerGraph) => boolean;

const asserted = (edge: { confidence: string }): boolean => edge.confidence === 'marker';

/**
 * The annotation draws its edge from the annotated symbol itself.
 *
 * `@CallsService` on a method that makes a request: the call it names becomes
 * an `http_calls` edge out of that very node.
 */
const drawsFrom =
  (...types: string[]): AnswerTest =>
  (id, graph) =>
    graph.edgesFrom(id, types).some(asserted);

/**
 * The annotation draws a publish or a subscribe, which is two edges rather than
 * one.
 *
 * `@Emits` gives the method a producer to call and the producer a channel to
 * emit on; `@Consumes` gives the channel a consumer and the consumer a method
 * to hand to. Looking only for an `emits` edge out of the method finds nothing,
 * which is why a row an annotation had plainly answered kept asking for the
 * annotation (R37).
 */
/**
 * The annotation draws a request of its own, beside the one that was not read.
 *
 * `@flowatlas-calls` does not repair the call it is written above: it adds a
 * second `ui_api_call` that joins, and the unreadable one stays exactly as it
 * was. So the row's own node can never carry the edge, and looking there left
 * a reader who had done what the hint asked still being asked (R39).
 *
 * Answered only where the annotation can be about nothing else: a method whose
 * annotations are at least as many as its unreadable requests. One of each is
 * the ordinary shape and the only one the project this is developed against
 * has. Two unreadable requests and one annotation is ambiguous, and silencing
 * both rows would hide a real gap behind an annotation that was never about
 * it — which is the fault this release exists to stop, not one to add.
 */
const annotatedBeside: AnswerTest = (id, graph) => {
  const found = requestsAround(id, graph);
  return found !== undefined && coversEveryUnread(found);
};

const publishesOrConsumes: AnswerTest = (id, graph) =>
  graph
    .edgesFrom(id, ['calls'])
    .filter(asserted)
    .some((edge) => graph.edgesFrom(edge.to, ['emits']).some(asserted)) ||
  graph
    .edgesTo(id, ['handles'])
    .filter(asserted)
    .some((edge) => graph.edgesTo(edge.from, ['consumes']).some(asserted));

/**
 * How to tell that the annotation a row asks for was written, and worked.
 *
 * A row is raised while one repository is being read, when nothing yet knows
 * whether an annotation somewhere answers it. Where one does, the edge is in
 * the joined graph with `confidence: marker` on it, and the row is a record of
 * what could not be read rather than something left to do (R36).
 *
 * Keyed by reason and valued by the shape to look for, so adding an annotation
 * means adding a line here rather than a branch anywhere. The shapes are named
 * because they are not all the same: some annotations draw one edge and some
 * draw a pair, and pretending otherwise is what R37 was raised about.
 */
export const MARKER_ANSWERS: Readonly<Record<string, AnswerTest>> = Object.freeze({
  // @CallsService, and its JSDoc twin @flowatlas-calls
  'dynamic-http-url': drawsFrom('http_calls'),
  'api-path-dynamic': annotatedBeside,
  'api-method-dynamic': annotatedBeside,
  // @Emits / @Consumes
  'channel-from-config': publishesOrConsumes,
  'channel-dynamic': publishesOrConsumes,
  'channel-const-unresolved': publishesOrConsumes,
  // @FlowEntry
  'dynamic-bot-trigger': drawsFrom('triggers', 'handles'),
});

/**
 * Whether an annotation has already answered this row.
 *
 * Takes the graph reader rather than a database, so the question can be asked
 * of anything that can list edges — and so nothing here has to know what a
 * database is.
 */
export const answeredByMarker = (
  reason: string,
  nodeId: string | undefined,
  graph: MarkerGraph,
): boolean => {
  const test = MARKER_ANSWERS[reason];
  if (test === undefined || nodeId === undefined) return false;
  return test(nodeId, graph);
};

/** What is said instead of "annotate this", once an annotation has been read. */
export const ANSWERED_HINT =
  'An annotation already says where this goes, so the row is a record of what could not be read. Nothing to do here.';

/**
 * Hints that only the joined graph can write, which therefore beat the row's own.
 *
 * A sharpener may return nothing, and then the row's own hint stands. This is
 * the only way the catalogue overrides what an extractor wrote, and it exists
 * because the extractor was right at the time and the linker has since learned
 * the half it was missing.
 */
export const SHARPENERS: Readonly<Record<string, (row: Unresolved, context: HintContext) => string | undefined>> =
  Object.freeze({
    'dynamic-http-url': (_row, context) => callsService(context),
    'api-path-dynamic': (_row, context) => flowatlasCalls(context),
    'api-method-dynamic': (_row, context) => flowatlasCalls(context),
  });

/**
 * A sentence per reason, for a row that arrived without one.
 *
 * Grouped by what writes the row, so that an extractor adding a reason has one
 * obvious place to add its advice. Anything missing here is still printed, and
 * is named under `unknownReasons` so that the gap is visible rather than quiet.
 */
export const HINTS: Readonly<Record<string, HintTemplate>> = Object.freeze({
  // Types (core/types/collector.ts)
  'type-unresolved': () =>
    'The checker could not resolve this type. Install the dependencies of the repository, or fix the paths in its tsconfig.',
  'type-generic-uninstantiated': () =>
    'The type argument is not known here, so the reference names the parameter. Nothing to fix.',
  'type-depth-exceeded': () =>
    'Nesting is written out to a fixed number of levels. Raise types.maxDepth to see further.',

  // Dependency injection (core/di, extractor-nestjs/di, extractor-angular/di)
  'di-type-unresolved': () => 'Inject a class, or name the provider with @Inject(TOKEN).',
  'di-token-unknown': (row) =>
    `No module in this repository provides ${named(row)}. Register it with { provide, useClass }, or force the adapter that does.`,
  'di-token-ambiguous': (row) =>
    `${named(row)} is registered with more than one class; which one is in effect depends on module order. Register it once.`,
  'inject-token-unresolved': () =>
    'The token is not a class, so there is nothing to point an edge at. Expected for an InjectionToken.',

  // Calls (extractor-nestjs/passes/calls.ts)
  'call-dynamic-receiver': () =>
    'The receiver has no single class type, so no method can be pointed at. Inject a class to make the edge visible.',
  'call-module-ref': () =>
    'Resolved through the container at run time. Inject the class instead to make the edge visible.',
  'call-through-token': () =>
    'A value provided for a token cannot be followed. Provide it with useClass to make calls through it visible.',

  // Modules and globals (extractor-nestjs)
  'module-import-dynamic': () =>
    'Import a module class, or X.forRoot(...); a computed import cannot be followed.',
  'global-wrapper-dynamic': (row) =>
    `${named(row)} is not registered with a class from this repository, so what it wraps cannot be read.`,
  'middleware-route-dynamic': () => 'Use a literal path or a controller class in forRoutes.',
  'bootstrap-not-found': () =>
    'Set services[].bootstrap in flowatlas.config.json, or pass --bootstrap, so globals can be read.',

  // Routes (adapters-entry)
  'route-path-dynamic': () =>
    'Give the route a string literal or a const string; a computed path cannot be matched against callers.',
  'route-handler-anonymous': () =>
    'A handler written in place has no name to point at. Register a named function instead.',
  'registry-key-dynamic': () =>
    'Register with a string literal so the way in can be named.',
  'registry-handler-anonymous': () =>
    'Give the handler a name and register that, so the code behind this can be pointed at.',
  'entry-registry-unconfigured': () =>
    'Name the table under adapters.entry.registries in flowatlas.config.json so each registration becomes an entry point.',
  'server-action-unread': () =>
    'Describe the builder that made it, or declare the action as an exported function, so the way in and its callers are visible.',
  'entry-http-description-inactive': () =>
    'Ordinary in a project of several repositories. If this is the one it was written for, check the spelling of its packages.',
  'entry-http-types-unmatched': () =>
    'Nothing here is a value of any type that description names. Check its appTypes against the package the framework is imported from.',
  'entry-http-routes-unmatched': () =>
    'Its types match and its routes do not. Check verbs, verbArgument, pathArg and handlerArg on that description.',

  // Bots (adapters-entry/nestjs-telegraf, telegraf-calls)
  'dynamic-bot-trigger': () =>
    "Use a string literal, a const from a shared package, or add @FlowEntry('<name>') to the handler.",
  'orphan-scene-decorator': () =>
    '@SceneEnter/@SceneLeave/@WizardStep must sit in a class decorated with @Scene or @Wizard.',
  'orphan-update-decorator': () =>
    '@Start/@Help/@Command/@Action/@On/@Hears must sit in a class decorated with @Update, @Scene or @Wizard.',
  'wizard-step-conflict': () => 'Two @WizardStep carry the same index in one scene; renumber them.',
  'bot-handlers-not-found': () =>
    "Handlers installed through a table of the project's own go under adapters.entry.registries.",
  'decorator-arg-dynamic': () =>
    'Use a literal or a const; a computed argument cannot be matched to anything.',

  // Channels (adapters-broker)
  'channel-from-config': (row) =>
    `The channel name is read from settings, so it cannot be followed. Annotate ${named(row)} with @Emits('<channel>') or @Consumes('<channel>').`,
  'channel-dynamic': (row) =>
    `The channel name is built at run time. Annotate ${named(row)} with @Emits('<channel>') or @Consumes('<channel>').`,
  'channel-const-unresolved': (row) =>
    `The const naming this channel could not be read. Move it to a package listed in sharedPackages, or annotate ${named(row)} with @Emits('<channel>').`,
  'payload-type-unknown': () =>
    'The call carries no payload argument, so nothing describes what travels on this channel. Pass a typed value.',
  'consumer-handler-unresolved': () =>
    'The listener does more than delegate, so the chain stops at the method that registered it. Delegate to a named method.',

  // Data layer (core/adapters/db, adapters-db)
  'unknown-db-package': () =>
    'Add a descriptor for the package to packages/adapters-db, so its methods are recorded as reads or writes.',
  'unknown-db-operation': () =>
    'Add the method to the operations of its descriptor, to record whether it reads or writes.',
  'db-receiver-name-only': () =>
    'Name the base class under adapters.db.localBaseClasses in flowatlas.config.json if this is a data layer of your own.',
  'db-layer-unread': () =>
    'Add the class to adapters.db.localBaseClasses in flowatlas.config.json, so calls through it are recorded as data access.',
  'db-package-unread': () =>
    'If the data layer is a class of this repository, add its base to adapters.db.localBaseClasses; if it is a library, add a descriptor for it.',
  'sql-parse-failed': () =>
    'The query is not a literal, so the tables it touches cannot be read. Use a literal, or annotate the call.',

  // Settings, caches and outgoing addresses (adapters-db/leaves-pass)
  'dynamic-config-key': () => 'The key is computed, so nothing can be recorded. Use a literal key.',
  'dynamic-cache-key': () =>
    'The key is built at run time. A literal prefix would make the pattern visible.',
  'dynamic-http-url': () =>
    "The address is built at run time. Annotate the calling method with @CallsService('<service>', '<METHOD> /<path>').",

  // The browser (extractor-angular)
  'api-path-dynamic': () =>
    'The address is built at run time. Annotate the method with /** @flowatlas-calls METHOD /path */.',
  'api-method-dynamic': () =>
    'The verb is chosen at run time. Annotate the method with /** @flowatlas-calls METHOD /path */.',
  'api-base-unknown': () =>
    'Add the settings key to services[].apiBaseEnv, and services[].apiTarget to say which service answers it.',
  'handler-not-found': (row) =>
    `${named(row)} is bound in a template and declared nowhere on the component. Rename the binding, or declare the method.`,
  'handler-not-a-method': () =>
    'The binding is an assignment, or a call on something that is not an injected class, so no method answers it. Nothing to fix.',
  'template-not-found': () => 'Could not read the template. Check templateUrl relative to the component file.',
  'template-not-parsed': () =>
    'The template could not be parsed, so every trigger in it is missing from the graph until it is fixed.',
  'route-link-dynamic': () =>
    'The path is built at run time, so no configured route can be matched against it. Nothing to fix.',
  'route-screen-unread': () =>
    'A route answers this link, but nothing said which component it shows — a redirect, or a loader that was not read.',
  'route-target-unresolved': (row) =>
    `No configured route answers ${named(row)}. Check the route table, or the prefix the router mounts it under.`,
  'route-loader-unread': () =>
    "Write the loader as () => import('./x').then((m) => m.X); a specifier built at run time is not followed.",

  // Joining the repositories (linker)
  'unknown-base-url-env': () =>
    'Add the settings key to services[].baseUrlEnv of exactly one service, so the address names a service.',
  'target-route-not-found': () =>
    "The target service serves no such route. Check its controllers for a rename, or annotate the call with @CallsService.",
  'ambiguous-route': () =>
    'More than one route in the target service answers this. Make the path more specific, or annotate the call with @CallsService.',
  'route-unguarded': () =>
    'Nothing in front of this route can refuse a request, and it reaches stored data. Add a guard, or mark it public with a decorator under doctor.publicDecorators or a pattern under doctor.publicRoutes.',
  'route-guard-skipped': () =>
    'A decorator named under doctor.skipGuardDecorators switches the guard off for this route, so nothing is missing — the decision is written in the source. Check that it still holds. A handler that checks the request in its own body can say so with /** @flowatlas-auth <how> */.',
  'route-shadowed': () =>
    'A worker answers this route before the application does, so the application handler and its guards never run. Remove one, or give the worker route the same checks.',
  'route-wildcard-only': () =>
    'Only a catch-all route answers this request, so nothing behind it is known to serve it. Check the target service for a renamed or missing route.',
  'ambiguous-route-target': () =>
    'Set services[].apiTarget on the frontend to say which service its settings key names.',
  'marker-service-unknown': () =>
    '@CallsService names a service that is not configured. Add it to services[] in flowatlas.config.json, or correct the annotation.',
  'marker-route-not-found': () =>
    '@CallsService points at a route the named service does not serve. Check its controllers, or correct the annotation.',
  'duplicate-node-id': () =>
    'Two repositories declared the same id. One of them was kept; rename the other, or split the shared file out into a package.',

  // Boundaries nothing could be compared on (contracts)
  ...Object.fromEntries(
    Object.entries(UNCHECKED_HINTS).map(([reason, hint]) => [reason, () => hint]),
  ),
});

/**
 * The sentence a group of rows is headed with, true of every member.
 *
 * A heading describes a kind, not a member. Most catalogue templates already
 * ignore the row they are handed and are that sentence exactly; the ones below
 * name the symbol they were written about, and a heading that names one
 * member's symbol asserts it of all of them (R35). Each is written once here,
 * in the general, with the specific left to the row it belongs to.
 */
export const KIND_HINTS: Readonly<Record<string, string>> = Object.freeze({
  'di-token-unknown':
    'No module in this repository provides the token these constructors ask for. Register it with { provide, useClass }, or force the adapter that does.',
  'di-token-ambiguous':
    'The token is registered with more than one class; which one is in effect depends on module order. Register it once.',
  'global-wrapper-dynamic':
    'The wrapper is not registered with a class from this repository, so what it wraps cannot be read.',
  'channel-from-config':
    "The channel name is read from settings, so it cannot be followed. Annotate the method with @Emits('<channel>') or @Consumes('<channel>').",
  'channel-dynamic':
    "The channel name is built at run time. Annotate the method with @Emits('<channel>') or @Consumes('<channel>').",
  'channel-const-unresolved':
    "The const naming the channel could not be read. Move it to a package listed in sharedPackages, or annotate the method with @Emits('<channel>').",
  'handler-not-found':
    'The binding names a method declared nowhere on the component. Rename the binding, or declare the method.',
  'route-target-unresolved':
    'No configured route answers the link. Check the route table, or the prefix the router mounts it under.',
});

/**
 * What a whole group is headed with, given nothing but its reason.
 *
 * Deliberately takes no row: a heading that can see a row is a heading that
 * will eventually quote one. Where the catalogue's template ignores the row it
 * is handed, that template is the kind's sentence already and is used as it is.
 */
export const kindHint = (reason: string): string | undefined => {
  const written = KIND_HINTS[reason];
  if (written !== undefined) return written;
  const template = HINTS[reason];
  if (template === undefined) return undefined;
  return template(ANONYMOUS, {});
};

/** Every reason this catalogue has advice for, in alphabetical order. */
export const KNOWN_REASONS: readonly string[] = Object.freeze(Object.keys(HINTS).sort());

/** What is said about a reason nobody registered — including where to register it. */
export const genericHint = (reason: string): string =>
  `unknown reason \`${reason}\` — register it in packages/cli/src/doctor/hints.ts so this row can say what to do`;

/**
 * The one sentence printed beside a row.
 *
 * Four sources in order: what the joined graph can say that the extractor could
 * not, then what the extractor wrote, then this catalogue, then the sentence
 * that admits the catalogue has a hole in it. There is no fifth, so no printed
 * row is ever without advice (§4).
 */
export const hintFor = (row: Unresolved, context: HintContext = {}): string => {
  const sharper = SHARPENERS[row.reason]?.(row, context);
  if (sharper !== undefined) return sharper;
  if (row.hint !== undefined && row.hint !== '') return row.hint;
  const template = HINTS[row.reason];
  return template === undefined ? genericHint(row.reason) : template(row, context);
};

/** Whether the catalogue knows this reason at all. */
export const isKnownReason = (reason: string): boolean =>
  Object.prototype.hasOwnProperty.call(HINTS, reason);
