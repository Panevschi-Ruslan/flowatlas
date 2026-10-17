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
import { canonicalReason, coversEveryUnread } from '@flowatlas/linker';

/**
 * Whether an annotation answered a row, and what is said once one has, live in
 * the linker since P80, so the MCP server demotes the same rows doctor does.
 * Re-exported here for the callers that always found them here.
 */
export {
  ANSWERED_HINT,
  answeredByMarker,
  canonicalReason,
  coversEveryUnread,
  MARKER_ANSWERS,
  requestsAround,
  type MarkerGraph,
} from '@flowatlas/linker';

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
 * Every spelling of every reason a project asked for, for a list it wrote itself.
 *
 * Used where `doctor.ignoreReasons` enters the command, so that one list of
 * silenced reasons covers rows carrying either spelling and neither the snapshot
 * nor the grouping has to know a rename happened.
 */
export const expandReasons = (reasons: readonly string[]): string[] => {
  const out = new Set<string>();
  for (const reason of reasons) {
    out.add(reason);
    out.add(canonicalReason(reason));
  }
  return [...out];
};

/**
 * One catalogue asked about one reason, and the only way any of them is asked.
 *
 * Every table in this file is keyed by a `reason`, and a reason arrives from a
 * graph or a baseline rather than from a list written here - which means these
 * tables can be asked about any word at all. An object literal answers
 * `constructor`, `toString` and `valueOf` with the language's own, so
 * `HINTS['constructor']` handed back `Object` and `template(row, context)` then
 * printed a row object where a sentence should be. Nothing produces those words
 * today; that is exactly when to close it, and R122 closed the same hole after a
 * lookup of this shape minted two `db_query` nodes labelled
 * `function toString() { [native code] }` (R130).
 *
 * Own keys only, in one place, rather than a `Map` per table: these catalogues
 * are long literals with a paragraph beside half their entries, and the reading
 * is what was unsafe, not the writing.
 */
const entryOf = <T>(catalogue: Readonly<Record<string, T>>, reason: string): T | undefined => {
  const key = canonicalReason(reason);
  return Object.hasOwn(catalogue, key) ? catalogue[key] : undefined;
};

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
    // A request between services whose verb a caller hands in (P91) keeps the
    // hint its reader wrote, which names the annotation a server takes.
    'api-method-dynamic': (_row, context) => (context.node?.type === 'http_out' ? undefined : flowatlasCalls(context)),
  });

/**
 * A sentence per reason, for a row that arrived without one.
 *
 * Grouped by what writes the row, so that an extractor adding a reason has one
 * obvious place to add its advice. Anything missing here is still printed, and
 * is named under `unknownReasons` so that the gap is visible rather than quiet.
 */
export const HINTS: Readonly<Record<string, HintTemplate>> = Object.freeze({
  // Reading (core/project.ts)
  'file-not-parsed': () =>
    'The parser could not read this file, so nothing in it is in the graph — no node, no edge, and no row but this one. Fix the syntax, or keep the file out of the globs the reader is given.',

  // What stands in for a package that is not installed (core/stand-ins.ts, P78)
  'package-from-repo': () =>
    'The package is not installed, and its types were read from its source in a repository this project reads. Nothing to do; the source may not be the version that runs, and installing the dependencies reads the installed copy instead (packageSources: false reads nothing in its place).',
  'package-source-ambiguous': () =>
    'Two directories of the project carry this package name, so neither is read in place of the missing install. Rename one in its package.json, leave one out of the configuration, or install the dependencies.',
  'package-version-differs': () =>
    'The source read in place of the package is not a version this service asks for, so its types may not be the ones it runs. Install the dependencies to read the version asked for.',
  'shape-file-unread': () =>
    "A file listed under shapes was not read: it is not there, does not parse, or declares no module. Fix the path or the glob, or the file: it holds `declare module '<package>' { ... }` blocks.",
  'shape-file-unmatched': () =>
    'A shape file declares a package that is not read from it here: nothing imports it, it is installed, or its source is read instead. Nothing to do while that holds; remove the block when it is no longer needed.',

  // The project's own extraction patterns (core/patterns, P121)
  'pattern-file-unread': () =>
    'A file listed under patterns was not read: it is not there, is not YAML, or is not a list of rules. Fix the path or the glob, or the file; flowatlas patterns test reads it the way the build does.',
  'pattern-not-expressible': () =>
    'A rule of a pattern file is not read: the part the row names cannot be said as a place in the call, so nothing of the rule is. Change that part, or describe the call under adapters in flowatlas.config.json; flowatlas patterns test shows the same refusal.',
  'pattern-ambiguous': () =>
    'Two rules of the pattern files match this call, so neither is read. Narrow one - its receiver type, a literal the call writes - or remove one; flowatlas patterns explain shows how far each matched.',
  'pattern-shadowed': () =>
    'A rule matches a call a written description already reads, and the written one wins. Nothing to do if the call is read right; otherwise check the rule\'s on.receiverType, or remove it.',
  'pattern-unmatched': () =>
    'A rule matches nothing in the services it applies to. Check its on.receiverType or function and its pattern against a call (flowatlas patterns explain <file:line>), or remove it.',

  // The build itself (cli/commands/build.ts)
  'service-read-nothing': () =>
    'A reader ran over this service and produced no node, so nothing about it is in the graph and every question asked about it answers nothing. Check its type in flowatlas.config.json against what its manifest declares, or write an adapter for the framework it is built on.',

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
  'module-controllers-unread': () =>
    'List the controller classes in the module, or a name that leads to an array of them in this repository. A spread of an array built elsewhere reads as no controllers at all, and which application serves an address is read from the module that declares its controller.',
  'module-providers-unread': () =>
    'List the providers in the module, or a name that leads to an array of them in this repository. A guard registered as APP_GUARD among providers that cannot be read is in front of every route, and the route audit cannot see it.',
  'global-wrapper-dynamic': (row) =>
    `${named(row)} is not registered with a class from this repository, so what it wraps cannot be read.`,
  'middleware-route-dynamic': () => 'Use a literal path or a controller class in forRoutes.',
  'bootstrap-not-found': () =>
    'Set services[].bootstrap in flowatlas.config.json, or pass --bootstrap, so globals can be read.',
  'fails-filter-unread': () =>
    'An exception filter in front of these routes hands the response a status this cannot read: a helper\'s answer, a lookup, a value built at run time. The statuses of what it catches are listed as assumed. Set the status in the filter itself, as a number or read off the exception (exception.status, exception.getStatus()), and the routes behind it say what they really answer.',
  'application-root-unread': () =>
    'Hand the factory call the root module class itself. An address is only an address within one application, so an application nobody can name shares an address space with every other one in this service, and where two of them serve one path the file that loses it contributes no node at all.',

  // Routes (adapters-entry)
  'route-path-dynamic': () =>
    'Write the path as a literal, a const, or a + or template of them, and every path of a list the same way; a path that needs a call or a run-time value to compute is not recorded as a route at all, so no caller can reach it.',
  'route-mount-unread': () =>
    'The route was read and the path its application is mounted under was not. Mount the application at a literal path, or declare its routes on the application that is served.',
  'route-handler-anonymous': () =>
    'The route is answered by whatever a call hands back - a package\'s own function, such as passport.authenticate(...), or a handler a function of this repository builds at run time from another function or a list - and that code is not read. Nothing needs fixing if that is intended; to give the route code to point at, register a named function of this repository that does the work.',
  'registry-key-dynamic': () =>
    'Register with a string literal so the way in can be named.',
  'registry-handler-anonymous': () =>
    'Give the handler a name and register that, so the code behind this can be pointed at.',
  'entry-registry-unconfigured': () =>
    'Name the table under adapters.entry.registries in flowatlas.config.json so each registration becomes an entry point.',
  'server-action-unread': () =>
    'Describe the builder that made it, or declare the action as an exported function, so the way in and its callers are visible.',
  'route-module-not-found': () =>
    'A route config names a module that is not a source file of this project, so the address it declares has nothing behind it here. Name the module by its path relative to the app directory as it is spelled on disk, or add the file.',
  'route-claimed-twice': () =>
    'Two route files resolve to one verb and address, so only the first is drawn. The framework refuses that or serves one of them; remove one, or move it to the address it was meant for.',
  'route-file-not-served': () =>
    'A file exporting a route verb sits under a directory the framework does not serve, so it answers at no address. Informational: it is the framework behaving as documented, and the row exists so that a file with a verb in it and no route to show for it is never silence.',
  'route-verb-unread': () =>
    'The file is served at a path but exports no verb this could read. Export GET, POST and the rest by name; a verb assembled at run time cannot be joined to anything that asks for it.',
  'route-handler-unread': () =>
    'The verb is exported and the code behind it was not read, so the way in is in the graph and nothing that happens after it is. Export the handler as a function declared here, or hand the work to the wrapper as a function this repository declares.',
  'middleware-matcher-unread': () =>
    'The matcher is a regular expression, so which routes it guards was not read and every one of them is reported as unguarded. Write it as a path pattern, or name the routes under doctor.publicRoutes.',
  'entry-http-description-inactive': () =>
    'Ordinary in a project of several repositories. If this is the one it was written for, check the spelling of its packages.',
  'entry-http-types-unmatched': () =>
    'Nothing here is a value of any type that description names. Check its appTypes against the package the framework is imported from.',
  'entry-http-routes-unmatched': () =>
    'Its types match and its routes do not. Check verbs, verbArgument, pathArg and handlerArg on that description.',
  'entry-http-routes-unplaced': () =>
    'Routes were read and only some of them could be placed at an address, so the ways in recorded for that service are a part of what it serves rather than the whole of it. The rows above name each application whose base could not be read.',
  'route-registry-unread': () =>
    'One mount installs every application in a collection, and nothing here puts an application into that collection, so however many routes it installs are missing. Put them in a list, or register each on the application it is mounted on with a literal path.',

  // Trees of procedures (adapters-entry/procedure-routers)
  'procedure-router-unread': () =>
    'This file serves a whole tree of ways in and the tree is assembled somewhere that was not read, so none of them is in the graph. Import the tree from inside this service, or add the package it comes from to sharedPackages.',
  'procedure-branch-unread': () =>
    'A member of a tree is neither a way in nor a tree that could be followed, so everything under that name is missing. It is usually a tree imported from outside what was read.',
  'procedure-key-dynamic': () =>
    'The key a way in is written under is computed, so it has no address a caller could be joined to. Write it as a name or a string.',
  'procedure-trees-unmatched': () =>
    'Nothing here is assembled by any of the names that reader looks for. Ordinary in a repository that only calls procedures; check assembledBy if this is the one that declares them.',
  'procedure-members-unmatched': () =>
    'Calls to the assembling name were found and no member of any of them ended a chain the way a way in does, so none of them was read as a tree. Check terminators on that description.',
  // Callers of procedures (extractor-react/passes/procedures)
  'procedure-path-dynamic': () =>
    'A step of the path a procedure is asked for by is computed, so the procedure it reaches cannot be named and the call is joined to nothing. Write each step as a name.',
  'entry-procedures-description-inactive': () =>
    'Ordinary in a project of several repositories. If this is the one it was written for, check the spelling of its packages.',

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
  'channel-from-environment': (row) =>
    `The channel is the value of ${typeof row.meta?.['variable'] === 'string' ? `the environment variable ${row.meta['variable']}` : 'an environment variable'}, set where the code is deployed and not in it. Where a function whose deployment is read runs this code, the channel is completed from the value it is deployed with and this row goes; it is left where nothing deployed is known to run it.`,
  'channel-dynamic': (row) =>
    `The channel name is built at run time. Annotate ${named(row)} with @Emits('<channel>') or @Consumes('<channel>').`,
  'channel-const-unresolved': (row) =>
    `The const naming this channel could not be read. Move it to a package listed in sharedPackages, or annotate ${named(row)} with @Emits('<channel>').`,
  'payload-type-unknown': () =>
    'The call carries no payload argument, so nothing describes what travels on this channel. Pass a typed value.',
  'consumer-handler-unresolved': () =>
    'The listener does more than delegate, so the chain stops at the method that registered it. Delegate to a named method.',

  // Starting a workflow or a function by its deployed name (adapters-broker, P24)
  'start-from-environment': () =>
    'What this call starts is the value of an environment variable, set where the code is deployed and not in it. It is completed from the value each function that runs the code is deployed with; this row is left where nothing deployed is known to run it.',
  'start-name-unread': () =>
    'The name of the workflow or function this call starts is not written where it can be read. Write the deployed name or its ARN, or a value of the environment the deployment sets; where the code names it some other way, say how in the `names` table of a starter description (adapters.starters), and where it is written in an earlier call of the same body that recorded what to start, point at that call with an `origin-call-argument` locator.',
  'starter-undescribed': () =>
    'A deployed function calls into a package whose source is not read, in the shape of a helper that starts a workflow or invokes a function by its deployed name: it is handed an id the same package made earlier in the body, or the package is installed with types that reach a client that starts things. If it is one, describe it under adapters.starters, as the row says; or make the package\'s source readable here.',

  // Data layer (core/adapters/db, adapters-db)
  'unknown-db-package': () =>
    'Add a descriptor for the package to packages/adapters-db, so its methods are recorded as reads or writes.',
  'unknown-db-operation': () =>
    'The query names a table, but its text does not open with a verb that says whether it reads or writes (SELECT, WITH … SELECT, INSERT INTO, UPDATE, DELETE FROM or TRUNCATE, as the very first word): a leading comment hides the verb, and EXPLAIN is not one of them. Start the string with its verb, with any comment after it; a statement that neither reads nor writes, such as EXPLAIN, can be left as it is. The operation comes from that verb, not from the descriptor, so the descriptor needs no change.',
  'db-receiver-name-only': () =>
    'Name the base class under adapters.db.localBaseClasses in flowatlas.config.json if this is a data layer of your own. A call the graph already draws as a static call into a repository method of this repository is not listed: its queries are read where they are written.',
  'test-directory-skipped': () =>
    'If the directory holds code the application runs, name it under readTestDirectories in the service entry in flowatlas.config.json.',
  'db-handover-unstated': () =>
    'State the type of the value the handover method is called on - an annotation or a cast to the ORM manager - so the query can be read.',
  'db-layer-unread': () =>
    'Add the class to adapters.db.localBaseClasses in flowatlas.config.json, so calls through it are recorded as data access.',
  'db-package-unread': () =>
    'If the data layer is a class of this repository, add its base to adapters.db.localBaseClasses; if it is a library, add a descriptor for it.',
  'sql-parse-failed': () =>
    'The query is not a literal, so the tables it touches cannot be read. Use a literal, or annotate the call.',
  'dynamic-table-name': () =>
    'The table this touches is not a literal, a constant, or a schema declared in this repository, so it cannot be read. Name it directly, or annotate the call. Read already without configuration: a field each class sets for a base whose queries use it (this.collectionName), a helper of the class that hands out the collection (this.coll()), and an entity class handed to a manager (manager.find(Rating)).',
  'db-call-at-module-level': () =>
    'The query runs when the module is imported, so there is no function or method to record it under. Move it into one to make it visible.',

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
  'api-base-override-unread': () =>
    'The call writes a base of its own and it could not be read, so the address was recorded as the path alone. Write that option as a literal or a constant.',
  'api-base-unknown': () =>
    'Add the settings key to services[].apiBaseEnv, and services[].apiTarget to say which service answers it.',
  'api-client-unread': () =>
    'A class of this repository is called by an HTTP verb and nothing could follow that verb to a request. Add the class to adapters.frontend.localClientClasses in flowatlas.config.json if it is a client of your own.',
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
  'route-config-unread': () =>
    'A piece of the route configuration was not read, so nothing behind it answers a link. Write the spread, the children or the loadChildren as a name that leads to an array or an object in this repository.',

  // Ways in declared where a service is deployed (adapters-entry/deployed-functions.ts, terraform)
  'infra-file-unparsed': () =>
    'This configuration file does not parse, so nothing in it is read. If the file is valid, this is a defect in the reader: report it with the line.',
  'infra-module-missing': () =>
    'A module call names a local directory that holds no configuration. Check the path; a local source is relative to the directory of the file that calls it.',
  'infra-module-undescribed': () =>
    'A module whose source is not in the repository was called, and nothing describes what it declares, so its functions and routes are not read. Describe it under adapters.infra.modules.',
  'infra-module-description-invalid': () =>
    'A value in a module description is not an expression in the module language. Write a string literal with its quotes, as "\"AWS_PROXY\"".',
  'function-name-unread': () =>
    'The name a function is deployed under depends on something the files do not settle, so nothing can join to it. Give the variable a default or a variable file, or write the name out.',
  'function-name-disputed': () =>
    'The variable files of this repository give a function two different names, one per environment. Choose the environment to read under services[].infra.vars.',
  'function-repeated-unread': () =>
    'A function is declared once per element of a collection the files do not settle, so neither how many there are nor their names are known. Give the collection a value the files settle.',
  'function-handler-unread': () =>
    'The handler of a function is not read, so the function has no code to point at. Write the handler as "<module>.<export>" and export a function, or a function wrapped by calls that take it as their first argument.',
  'function-handler-not-found': () =>
    'The handler a function names is not where the deployment packages it from. Check the handler string, the directory, and the tsconfig that compiles it.',
  'function-handler-ambiguous': () =>
    'Nothing says what a function is packaged from, and more than one source file could be its handler. Build the package from an archive of a source directory so the handler is read from where it is.',
  'function-source-unread': () =>
    'Nothing says what a function is packaged from, and no source file of the right name exports its handler. Build the package from an archive of a source directory the configuration names.',
  'function-runtime-unread': () =>
    'The function runs on a runtime whose code is not read. It is still in the graph under its name. Nothing to do here.',
  'function-image-unread': () =>
    'The function is a container image, whose handler is set inside the image. It is in the graph under its name. Nothing to do here.',
  'route-path-unread': () =>
    'The path or verb of an API route depends on something the files do not settle, so the route cannot be joined to anything that calls it.',
  'route-target-unread': () =>
    'What answers a route is not read. Point the integration at a function, a queue, a topic or a bus the files declare, or at one by a name they settle.',
  'route-base-path-unread': () =>
    'A custom domain maps an API at a base path, and the API it maps or the base path is not read, so the routes of that API are at an address not known in full and nothing calling them joins. Write the base path and the API so the files settle them.',
  'subscription-source-unread': () =>
    'What a rule, a subscription, a mapping or a pipe takes its messages from is not read, so it is drawn on no channel. Write the queue, topic, bus or stream so the files settle it: a reference to what the configuration declares, or its ARN. A source of a kind nothing here reads is said once, at info.',
  'subscription-target-unread': () =>
    'What a rule, a subscription, a mapping or a pipe hands its messages to is not read. A target of a kind nothing here follows - a container task, an e-mail address, an API destination - is said once at info and needs nothing; a function, workflow, queue, topic or bus whose name the files do not settle needs one.',
  'subscription-forward-unread': () =>
    'Something that is not a rule on a bus - a schedule, a queue, a pipe - puts what it takes on a bus, and which events those are is not named, so no channel on that bus is drawn. A rule that takes its events by name or by a pattern carries them on. Nothing to fix unless that bus has subscribers you expect to see.',
  'bucket-notification-unread': () =>
    'A notification of a bucket is not read: the bucket it is of, a target block the files do not settle (a dynamic block over what is known only once deployed), its events or a key filter. Write it so the files settle it - a literal, or a reference to the bucket, function, queue or topic the configuration declares.',
  's3-write-matches-nothing': () =>
    'A write to a bucket fires an event that none of the bucket\'s notifications takes, by its events or by the start and end of the key. Nothing to fix if the write is meant to notify nobody; otherwise the notification\'s events or filters are not the ones meant.',
  'query-in-loop': () =>
    'A loop runs a query, cache call, HTTP call or publish once per item - directly, or through a function it calls - so a list of n items costs n round trips (likely N+1), listed by how many ways in reach it. Read every item in one call before the loop, or batch the calls; nothing to fix if the list is known to stay small. Loops bounded on purpose are set aside and counted in `flowatlas stats`: chunks, pages, cursors, retries, literal lists, loops around nothing but batch calls, migrations. A loop whose every query is a conditional write or a send to one recipient is a note. Name a chunking helper under callShape.boundedCalls, a guarded write under callShape.conditionalWrites, and a one-recipient host under callShape.perItemHosts.',
  'event-pattern-unread': () =>
    'A rule\'s event pattern is not read, so the rule is on no channel. Write it as JSON, a heredoc or jsonencode of what the files settle.',
  'api-body-unread': () =>
    'An API is created from an OpenAPI body that is not read, so none of its routes are drawn. Write the body as templatefile(), file(), jsonencode() or a heredoc, with a path the files settle and text that is JSON or YAML with paths.',
  'deployment-unread': () =>
    'The repository declares Lambda packages and no deployment description this reads. Functions are read from Terraform; the handlers are still read as code, and nothing reaches them.',

  // Joining the repositories (linker)
  'route-root-not-found': () =>
    'A route hangs from a point of an API that no configured service publishes, so its full path is not known. Add the repository that declares that API to the configuration.',
  'route-root-ambiguous': () =>
    'A route hangs from a point of an API that two declarations place differently. One of them is stale.',
  'invoke-target-not-found': () =>
    'A route names its function by the name it is deployed under, and no configured service deploys a function of that name. Add the repository that deploys it to the configuration.',
  'invoke-target-ambiguous': () =>
    'Two services deploy a function under one name, so which one answers is not known. One of the two declarations is stale, or two environments need telling apart with services[].infra.vars.',
  'unknown-base-url-env': () =>
    'Add the settings key to services[].baseUrlEnv of exactly one service, so the address names a service.',
  'service-binding-unknown': () =>
    "A worker's request goes through a binding, and either no wrangler file of the worker declares it under services, or the worker it is bound to is not a configured service by name or alias. Add the worker's name to services[].aliases of the service it is.",
  'target-route-not-found': () =>
    "The target service serves no such route. Check its controllers for a rename, or annotate the call with @CallsService.",
  'route-mount-assumed-empty': () =>
    'The request was joined by taking the part in front of the route’s address as empty: it is read from settings that every committed environment file of the service leaves empty, so it is taken as where a deployment mounts the service. The join is marked heuristic. A deployment that sets those settings serves every route behind them, and the join is then wrong.',
  'ambiguous-route': () =>
    'More than one route in the target service answers this. Make the path more specific, or annotate the call with @CallsService.',
  'ambiguous-route-application': () =>
    'Two applications inside one service serve this address, and each of them really does answer it. Nothing is wrong with the route: which one a request from outside reaches is decided by how they are deployed, and no source says. The row names both rather than guessing one.',
  'ambiguous-route-api': () =>
    'Two APIs or load balancers of one deployment serve this address, each in front of a function of its own, and the name of the setting the call reads its base URL from names neither. Name the setting after the API (BILLING_API_URL for billing-api), or annotate the call with @CallsService.',
  'base-url-from-files': () =>
    'No service claims the setting a request\'s base address is read from, and the value a file gives it names one: an example environment file, a container\'s environment, a deployment\'s variables, or the code\'s own fallback. Only the address is kept, and the join is marked heuristic unless the value is the one a function running the request is deployed with. Add the setting to services[].baseUrlEnv to say so outright; settingFiles.read: false turns the reading off.',
  'base-url-from-name': () =>
    'No service claims the setting a request\'s base address is read from and nothing read gives it a value, and the setting is named after exactly one service (CATALOG_URL for catalog), which was taken. The join is marked heuristic. Add the setting to services[].baseUrlEnv of the service it really is.',
  'route-api-guessed': () =>
    'Several APIs or load balancers serve this address; the one whose name shares the most words with the setting the base URL is read from was taken, and the join is marked heuristic. Annotate the call with @CallsService where that is wrong.',
  'route-unguarded': () =>
    'Nothing in front of this route can refuse a request, and it reaches stored data. Add a guard, or mark it public with a decorator under doctor.publicDecorators or a pattern under doctor.publicRoutes. Routes public by decision can be accepted together: flowatlas accept route-unguarded --service <name> --path "<METHOD> /prefix/*" --note "<why>".',
  'route-checked-in-body': () =>
    'No guard is in front of this route, and its own code throws a 401 or a 403, so it checks who is asking in the body. The exception may be built by a helper that chooses it at run time (throw toHttpError(result)): then the statuses listed are what the helper\'s table can give, or, where the table cannot be read, the test before the throw is of what a check of who is asking answered. Nothing is missing if that check runs before the data is read, which this cannot tell. A guard makes the check visible to every reader; /** @flowatlas-auth <how> */ says it in words.',
  'route-public-declared': () =>
    'The handler or its controller says the route is open on purpose, with /** @flowatlas-public <why> */, so nothing is missing; the reason is listed so the decision can be reviewed. Check that it still holds.',
  'marker-reason-missing': () =>
    'A /** @flowatlas-public */ marker gives no reason. The route is taken as public all the same; write why after the marker so whoever reviews it can check the decision still holds.',
  'route-guard-skipped': () =>
    'A decorator named under doctor.skipGuardDecorators switches the guard off for this route, so nothing is missing — the decision is written in the source. Check that it still holds. A handler that checks the request in its own body can say so with /** @flowatlas-auth <how> */.',
  'route-shadowed': () =>
    'A worker answers this route before the application does, so the application handler and its guards never run. Remove one, or give the worker route the same checks.',
  'route-wildcard-only': () =>
    'Only a catch-all route answers this request, so nothing behind it is known to serve it. Check the target service for a renamed or missing route.',
  'ambiguous-route-target': () =>
    'Set services[].apiTarget on the frontend to say which service its settings key names.',
  'marker-service-unknown': () =>
    '@CallsService or @flowatlas-calls names a service that is not configured. Add it to services[] in flowatlas.config.json, or to services[].aliases of the service it means, or correct the annotation.',
  'marker-route-not-found': () =>
    '@CallsService or @flowatlas-calls points at a route the named service does not serve. Check its controllers, or correct the annotation.',
  'procedure-not-found': () =>
    'No procedure of that path is declared by the caller\'s own service or by any service its apiTarget names. Check the tree for a rename; if another service declares it, name that service in apiTarget.',
  'procedure-ambiguous': () =>
    'More than one service the caller is configured to call declares this procedure. Leave only the one it talks to in its apiTarget.',
  'procedure-call-mismatch': () =>
    'The procedure is asked for as one kind of call and declared as another, and the server refuses a call of the kind it did not declare. Call it as declared.',
  'duplicate-node-id': () =>
    'Two repositories declared the same id. One of them was kept; rename the other, or split the shared file out into a package.',

  // An end that was declared rather than read (doctor/age.ts). Named after the
  // document and not after one format of it: there are two, and a reader with an
  // AsyncAPI document was being told something about OpenAPI. `RENAMED` above is
  // what keeps the old spelling working in a configuration that silenced it.
  'document-age': () =>
    'Nothing here can check a document against the running service, so how recently the document was updated is the only evidence there is that it is still true. Fetch the current one from whoever owns the service if it is behind.',

  // What traffic answered beside what the code declares (doctor/runtime.ts, P106).
  // Asked of the observed file at doctor time, never stored in the graph.
  'failure-seen-undeclared': () =>
    'Real traffic got this status from the way in and no failure read off its code says it can: an unhandled throw, a constraint nobody mapped, a framework answer. Read a failing request (the MCP tool trace_for) and map the exception to the status it should answer, or declare it, and the route says what it really fails with.',
  'failure-declared-unseen': () =>
    'The code says the way in can fail with this and no request in the observed window answered it: an error path nothing exercised, or one that cannot happen any more. Traffic differs per environment and per week, so it is a question for a test, not proof the path is dead.',

  // Workflows written down as state machine definitions (stepfunctions)
  'workflow-definition-unreadable': () =>
    'The definition could not be read as a state machine, so no step of it is in the graph. Fix the syntax, or give the file another name if it is not a definition.',
  'workflow-definition-invalid': () =>
    'The definition names a state that is not there, or names one twice, and the service would refuse it. What is drawn is what the file says, which is not what runs. Correct the definition.',
  'workflow-named-by-file': () =>
    'A definition read on its own does not say what it is deployed as, so it is named after its file and anything joined to it by that name is drawn as heuristic. Read it from the file that deploys it to make the name certain.',
  'workflow-name-duplicate': () =>
    'Two definitions in one service would be one workflow, so only the first is drawn. Rename one of the files.',
  'workflow-target-dynamic': () =>
    'The step chooses what it calls when it runs, from its input, so no edge is drawn for it. Nothing to fix here.',
  'workflow-template-unbound': () =>
    'The step names what it calls through a placeholder that whatever deploys the definition fills in. Read the definition from the file that deploys it, or write the name in place.',
  'workflow-target-unreadable': () =>
    'The step says it calls something and does not say what, or says it in a form that names nothing. Write the name or the ARN the service expects.',
  'workflow-name-unread': () =>
    'The name a workflow is deployed under depends on something the files do not settle, so nothing can start it by name. Its steps are still drawn. Give the variable a default or a variable file, or write the name out.',
  'workflow-definition-not-loaded': () =>
    'The deployment declares a workflow whose definition is not read, so none of its steps is drawn. Write the definition with file(), templatefile(), jsonencode() or a heredoc, with a path the files settle.',

  // A name joined across services (linker/reference-link.ts)
  'reference-not-found': () =>
    'Something here names what it reaches by the name it is deployed under, and no configured service declares that name. Add the repository that deploys it to the configuration.',
  'reference-ambiguous': () =>
    'More than one configured service declares the same deployed name, so nothing was joined. One of the declarations is stale, or two environments are configured as one project.',

  // Values a deployment gives the code it runs, and filters on channels (linker)
  'environment-not-set': () =>
    'Code sends to the value of an environment variable, and a function that runs it is not deployed with that variable, so where it sends from that function is not known. Set the variable in the function\'s environment, or correct the name the code reads.',
  'environment-from-files': () =>
    'Code sends to the value of an environment variable that no function running it is deployed with, and a file at the top of the repository writes it down once: an example environment file, a container\'s environment, a deployment\'s variables. That value was used, and the edge is marked heuristic. Set the variable where the function is deployed to say so outright.',
  'environment-value-unread': () =>
    'Code sends to the value of an environment variable, and the value a function is deployed with is not read. Where the variable files disagree, choose the environment under services[].infra.vars; otherwise give the value something the files settle.',
  'stream-filter-not-matched': () =>
    'A mapping from a stream hands its function only the records its filter lets through, and the filter is recorded on the edge, not evaluated: every write onto the stream is drawn as reaching the function. Nothing to fix.',
  'stream-no-writer': () =>
    'A function reads a table\'s stream or a stream, and nothing the configured services write lands on it. The writer may be in a repository the configuration does not name, or outside any. Nothing to fix if it is.',
  'subscription-matches-nothing': () =>
    'A rule takes events by a pattern that nothing the configured services publish matches. A rule for events from outside - another account, a partner, the platform itself - is a way in, not a fault. Nothing to fix if that is what it is.',
  'invoker-not-read': () =>
    'A permission lets a service run the function, and what that service runs it on is not read. The function is still a way in of its own, so nothing reaching it in the graph does not mean nothing runs it. Nothing to fix.',
  'iot-action-not-read': () =>
    'An IoT rule hands its messages to a service this reading does not follow - a delivery stream, a log group, an HTTP endpoint, another topic. Its other actions are drawn; nothing past this one is. Nothing to fix.',

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
  'channel-from-environment':
    'The channel is the value of an environment variable, set where the code is deployed and not in it. It is completed from the value each function that runs the code is deployed with; this row is left where nothing deployed is known to run it.',
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
  const written = entryOf(KIND_HINTS, reason);
  if (written !== undefined) return written;
  const template = entryOf(HINTS, reason);
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
  const sharper = entryOf(SHARPENERS, row.reason)?.(row, context);
  if (sharper !== undefined) return sharper;
  if (row.hint !== undefined && row.hint !== '') return row.hint;
  const template = entryOf(HINTS, row.reason);
  return template === undefined ? genericHint(row.reason) : template(row, context);
};

/** Whether the catalogue knows this reason at all. */
export const isKnownReason = (reason: string): boolean => entryOf(HINTS, reason) !== undefined;

/**
 * What one finding is, in a few words, one and many (P81).
 *
 * A finding is something about the code a reviewer acts on, and a line saying
 * "2 findings" says nothing about which; doctor's findings line names each by
 * these. Keyed by the reasons `ROW_KINDS` classes as findings, and a test holds
 * the two lists together. A finding with no entry is named by its reason.
 */
export const FINDING_LABELS: Readonly<Record<string, readonly [one: string, many: string]>> = Object.freeze({
  'query-in-loop': ['likely N+1', 'likely N+1s'],
  'route-unguarded': ['route with no guard', 'routes with no guard'],
  'marker-reason-missing': ['public marker with no reason', 'public markers with no reason'],
  'route-shadowed': ['route a worker answers first', 'routes a worker answers first'],
  'route-claimed-twice': ['route claimed twice', 'routes claimed twice'],
  'route-file-not-served': ['route file served at no address', 'route files served at no address'],
  'wizard-step-conflict': ['wizard step numbered twice', 'wizard steps numbered twice'],
  'workflow-name-duplicate': ['workflow defined twice', 'workflows defined twice'],
  'workflow-definition-invalid': ['workflow definition the service refuses', 'workflow definitions the service refuses'],
  'orphan-scene-decorator': ['scene handler outside a scene', 'scene handlers outside a scene'],
  'orphan-update-decorator': ['bot handler outside an update class', 'bot handlers outside an update class'],
  'procedure-call-mismatch': ['procedure called as the wrong kind', 'procedures called as the wrong kind'],
  's3-write-matches-nothing': ['bucket write no notification takes', 'bucket writes no notification takes'],
  'stream-no-writer': ['stream nothing writes to', 'streams nothing writes to'],
  'subscription-matches-nothing': ['rule nothing published matches', 'rules nothing published matches'],
  'failure-seen-undeclared': ['status seen that the code does not declare', 'statuses seen that the code does not declare'],
});

/** One finding reason and its count, in words: `1 likely N+1`, `2 routes with no guard`. */
export const findingLabel = (reason: string, count: number): string => {
  const label = entryOf(FINDING_LABELS, reason);
  if (label === undefined) return `${count} ${reason}`;
  return `${count} ${count === 1 ? label[0] : label[1]}`;
};

/**
 * Groups of findings said as one list, most rows first, then by reason: a
 * reason split across two levels is said once, with both counts added.
 */
export const findingsSaid = (groups: ReadonlyArray<{ reason: string; count: number }>): string => {
  const byReason = new Map<string, number>();
  for (const group of groups) byReason.set(group.reason, (byReason.get(group.reason) ?? 0) + group.count);
  return [...byReason]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([reason, count]) => findingLabel(reason, count))
    .join(', ');
};
