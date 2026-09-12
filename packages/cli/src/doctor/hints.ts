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
}

export type HintTemplate = (row: Unresolved, context: HintContext) => string;

const meta = (context: HintContext, key: string): string | undefined => {
  const value = context.node?.meta?.[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
};

const named = (row: Unresolved): string => row.symbol ?? 'the call';

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
  const method = path === undefined ? '<METHOD>' : (meta(context, 'method') ?? 'GET').toUpperCase();
  const named = service === undefined ? '' : ` ${service} is what answers it.`;
  return (
    `The address is built at run time.${named} Annotate the method with ` +
    `/** @flowatlas-calls ${method} ${path ?? '/<path>'} */.`
  );
};

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
