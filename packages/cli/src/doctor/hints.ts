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
  // What the graph refused to write (core/builder.ts, R180)
  'edge-end-missing': () =>
    'A reader drew an edge to a node it never wrote, so the edge is left out and the rest of the service is read. A defect of flowatlas rather than of the code: report it with this row, which names the edge.',

  // What stands in for a package that is not installed (core/stand-ins.ts, P78)
  'package-from-repo': () =>
    'The package is not installed, and its types were read from its source in a repository this project reads. Nothing to do; the source may not be the version that runs, and installing the dependencies reads the installed copy instead (packageSources: false reads nothing in its place).',
  'package-source-ambiguous': () =>
    'Two directories of the project carry this package name, so neither is read in place of the missing install. Rename one in its package.json, leave one out of the configuration, or install the dependencies.',
  // What a framework's build would have written for the compiler (core/conventions.ts, P240)
  'aliases-from-convention': () =>
    "The framework writes these aliases into a tsconfig of its own when it prepares the project, and that file is not in the checkout, so they were read as the framework documents them. Nothing to do; run the framework's prepare step before building to read the ones it writes instead.",
  'aliases-from-config': () =>
    'These aliases are named by a configuration the tsconfig that was read does not mirror - a bundler configuration, or a project a solution tsconfig refers to - and were read from there. Nothing to do; naming them in the tsconfig makes the compiler and this reading agree.',
  'implicit-imports-from-convention': () =>
    'The framework imports these names for a file that uses them with no import line, and they were read as imports of the files that export them. Nothing to do.',
  'implicit-import-ambiguous': () =>
    'The name is used with no import, and two files the framework imports names from both export it, so the call is not joined to either. Rename one of them, or import the name from the file meant.',
  'framework-layer-unread': () =>
    "The application extends a layer that is not read - one downloaded when the application builds, installed from a registry, named in code, or outside the repository and its workspace - so its pages, routes, composables and aliases are missing from the graph. Extend it by its path in the repository, or read it as a service of its own.",
  'framework-layer-read': () =>
    "The application is built with these layers, and each was read as part of it: its pages, routes, composables and aliases are the application's. Nothing to do.",
  'framework-layer-overridden': () =>
    'Two parts of the application give this page or route, and the framework uses the one of the higher-ranked part; the lower one is read as code, and not as a page or route. Nothing to do, unless the lower one was meant to be used.',
  'framework-layer-alias': () =>
    "A layer imports its own code with `~` or `@`, which the framework resolves against the application in every layer, and the application has no such file, so the import is not joined. Import it with a relative path, or through the layer's named alias.",
  'framework-module-read': () =>
    "The application is built with these modules of the repository, and what each adds when the application builds - names used with no import, routes, pages, aliases - was read from its code. Nothing to do.",
  'framework-module-installed': () =>
    "These modules are packages the application installs, run when it builds; what a package adds is not read as the repository's code. Nothing to do for the ones whose additions are their own package's; for another, name an alias it adds in the tsconfig's paths, or describe a route it serves.",
  'framework-environment-differs': () =>
    "The configuration overrides some settings for one environment, and the graph is the production build's, so a layer, module or setting only another environment has is not read. Nothing to do; write what every build shares outside the overrides.",
  'framework-module-skipped': () =>
    "A module of the repository writes this call under a condition, and the options the configuration hands the module rule it out, so what it would add is not built and not drawn. Nothing to do; change the option to have it added.",
  'navigation-external': () =>
    "A page, a component or a route middleware navigates to an address with a host, or with `{ external: true }`: it leaves the application, so no page of it is joined. Nothing to do; the row says where the application hands the visitor on.",
  'navigation-unresolved': () =>
    "A page, a component or a route middleware navigates - `navigateTo(...)`, `<NuxtLink to>` - to an address no page of the application shows, to one two pages fit as well, or to one written as code, so the page it shows is not joined. Correct the address or the name, add the page, or write the address as a literal (a template of one, or `{ name: '...' }`).",
  'framework-feature-off': () =>
    "The repository writes code for a feature its framework builds only behind a flag - Nitro's tasks, before Nitro 3 - and the configuration leaves the flag off, so the build registers none of it. The code is drawn and marked `enabled: false`. Turn the flag on to have it built, or remove the code.",
  'framework-module-unread': () =>
    "A module the application is built with, or something it adds, could not be read: the module is written as code or in the configuration itself, names nothing, or hands the framework a path that is not built from its own file. Build the path from the module's file, with `createResolver(import.meta.url).resolve(...)`, or move the module to a file of `modules/`.",
  'implicit-import-overridden': () =>
    'More than one part of the application exports this name, and the framework imports it from the higher-ranked one, which is the one joined. Nothing to do; rename the other to use both.',
  'framework-setting-dynamic': () =>
    "A setting of the framework's configuration is written as code rather than as a literal, so its default was read in its place. Write it as a literal, or name what it sets in the tsconfig's paths.",
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
  'module-import-not-installed': (row) =>
    `The module is a class of ${typeof row.meta?.['package'] === 'string' ? row.meta['package'] : 'a package'}, which is not installed, so what it provides and exports is not read. Install the dependencies where the map is built; nothing in the code needs to change.`,
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
  'fails-interceptor-unread': () =>
    'An interceptor around these routes handles their errors in a way this cannot read: a catchError(...) whose callback calls a helper or is a method, a try/catch around next.handle(), a promise .catch(), an installed interceptor. What the routes fail with is listed as assumed. Map an error in catchError(...) with throwError(() => new SomeException()), a throw, a rethrow (throwError(() => err)) or a value (of(...)), branching on instanceof, and the routes behind it say what they really answer.',
  'application-root-unread': () =>
    'Hand the factory call the root module class itself. An address is only an address within one application, so an application nobody can name shares an address space with every other one in this service, and where two of them serve one path the file that loses it contributes no node at all.',

  // Routes (adapters-entry)
  'route-path-dynamic': () =>
    'Write the path as a literal, a const, or a + or template of them, and every path of a list the same way; a path that needs a call or a run-time value to compute is not recorded as a route at all, so no caller can reach it.',
  'fs-route-handler-not-read': () =>
    'The file serves a route and its default export is not a handler written in place. Export defineEventHandler((event) => ...) as the default, or describe the route in flowatlas.config.json.',
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
  'graphql-field-resolved-twice': () =>
    'Two resolvers answer one GraphQL field; the server runs one of them. Remove one, or move it to the field it was meant for.',
  'graphql-federation-not-read': () =>
    'Part of a federated graph cannot be read: a supergraph the registry hands the router at run time, one built by code at start or not committed, a subgraph schema in the registry, or a subgraph no gateway in the project names. Requests are joined as far as what was read; commit the supergraph or its rover configuration, or add the gateway to the project.',
  'local-port-shared': () =>
    'The request names a port on this machine, and two or more services listen on it: their code starts a server there, or their setting files (an example environment file, a published container port) place them there. Which one a local run reaches is whichever started first, so the request is not joined. Name the host (localhost:<port>) under services[].hosts of the service it means, or give the servers different ports.',
  'published-port-unheard': () =>
    'A compose file or a `docker run` publishes a container port, or a cluster\'s service object routes its port to a container port (`targetPort`), that the service\'s code is not read listening on: the code starts its server on another port, reads its port from a setting the container\'s environment does not give, or starts it in a way the reader does not follow. A request to the published port or the routed name is still joined to the service by the file, as a guess. Map or route the port to the one the server listens on, or give the container the setting.',
  'proxy-rule-unread': () =>
    'A server forwards a path by a rule the reader does not follow: a prefix written as a pattern, a target address read from a setting or built at run time, or a rewrite that is not a literal replacement of the prefix. Requests under it are joined as if no proxy were there. Write the rule with literals, or annotate the request with the service it reaches.',
  'proxy-chain-unfollowed': () =>
    'A request is forwarded by one server\'s proxy to another server whose own proxy forwards it again, more times than the linker follows, or back to a server it already passed. The request is not joined. Check the rules named for a target that points back the way the request came, or annotate the request with the service it reaches.',
  'manifest-unread': () =>
    'A cluster manifest says where a service is reached in a way the reader does not follow: a chart template whose conditions nothing in its values decides and whose ways declare different ports, names or routes; a template that ranges over a value no file gives; a patch operation other than add, replace or remove; a base that is not in the project; or a way in that splits requests between two services. What is written as a literal is still read. Give the value in the chart\'s values, write the patch as a strategic merge, or annotate the request with the service it reaches.',
  'manifest-overlay-unchosen': () =>
    'Several overlays build on the same base, or a chart is installed several ways, and they declare different ports, names or routes, so which one the cluster runs is not something the files say. The base (or the chart\'s own values) is read alone. Choose the environment under settingFiles.environment (an overlay folder or a values file named for it is then read), or name the overlay under settingFiles.overlays and the values files under settingFiles.chartValues.',
  'release-need-undefined': () =>
    'A helmfile release lists under `needs` a release the helmfile (with the bases it layers) does not declare, by that name or in that namespace: helmfile refuses to apply the helmfile, so nothing in it is installed as written. The releases are still read. Name a release the helmfile declares, written namespace/name where its namespace is not the one assumed, or remove the need.',
  'server-request-without-origin': () =>
    'A server\'s own code makes a request with no host through the platform `fetch` (a Next route handler or server component, a Nitro route): on the server there is no page whose address it could be resolved against, so the request throws as written. It is drawn to the route the path names, as the author meant. Build the address from a setting that gives the server\'s own address, call the code behind the route directly, or use a client that answers it in process (Nitro\'s `$fetch`).',
  'proxied-to-third-party': () =>
    'A request is forwarded by its server\'s proxy to a host no service of the project is reached at, so it leaves the project there: it is drawn to that host as a third party. If the host is one of the project\'s services, name it under services[].hosts of that service.',
  'network-port-unreachable': () =>
    'A request on a container\'s or a cluster\'s network names a port the service is not reached at there: the port a compose file or `docker run` publishes on the machine running it (reached on the network at the container\'s own port), or the containers\' own port behind a cluster\'s service name (reached at the port the name routes). The request will not connect, so it is not joined. Use the port the network reaches the service at.',
  'graphql-subgraph-not-joined': () =>
    'A gateway names a subgraph whose address reaches no configured service, so the fields that subgraph resolves are not joined and the composition is a guess. Add the address\'s setting to services[].baseUrlEnv, or its host to services[].hosts, of the service that is the subgraph.',
  'graphql-composition-conflict': () =>
    'Composition refuses this graph: two subgraphs resolve one field and not every one marks it @shareable, or a subgraph resolves a field of an entity it declares no key for. The field is drawn to each owner as a choice; mark it @shareable, move it with @override(from:), or declare the key.',
  'graphql-supergraph-drift': () =>
    'The supergraph the router plans by and a subgraph\'s source disagree: a field it gives the subgraph is gone, or a root field the subgraph added is not in it. Compose the supergraph again and commit it.',
  'graphql-auth-not-checked': () =>
    'The subgraphs mark fields with the router\'s authorization directives (@authenticated, @requiresScopes, @policy), and the gateway that composes them is an Apollo Gateway, which does not check them: a request through it reaches those fields unchecked. Serve the graph with a router that checks them, or check who is asking in the subgraph\'s resolvers.',
  'graphql-requires-auth-not-carried': () =>
    'A field resolved with @requires does not carry an authorization directive one of the fields it requires carries. The router checks the client\'s operation and not the fields it adds to the plan for a @requires, so those are fetched unchecked and the requiring field is answered from them; composition (Federation 2.9 and later) refuses the supergraph for it. Put the same directive on the requiring field.',
  'graphql-entity-type-unsaid': () =>
    'A subgraph owns an entity interface other subgraphs make entity calls for, and writes neither its reference resolver nor a type resolver: the call arrives naming the interface, so the subgraph cannot say which of its types the item is, and refuses it. Write the interface\'s __resolveReference answering with the item and its __typename, or __resolveType.',
  'graphql-context-not-reached': () =>
    'A field takes an argument the router fills from a context (@fromContext), and no type above it in the selection sets that context (@context), so what the argument needs is not planned. Select the field under the type that sets the context, or pass the argument another way.',
  'graphql-shareable-choice': () =>
    'More than one subgraph resolves the field and none is the one that fetched its parent, so the router chooses by cost at run time. Each is drawn, heuristic. Nothing to do here.',
  'graphql-field-no-resolver': () =>
    'The operation asks the service for a field its schema has and no resolver of it answers, so the request stops at the endpoint; or, where the server answers some requests by code of its own before its schema, a field no resolver declares, which only that code may answer. Resolve the field, or correct the operation.',
  'graphql-endpoint-unread': () =>
    'A GraphQL module\'s options, its path, or which of a server\'s several schemas serves a resolver could not be read, so the endpoint stands at the library\'s default path or the resolver at none. Write the options as an object (in place, answered by useFactory, or by the class\'s createGqlOptions()), the path as a literal, constant or enum member, and include the resolver\'s module or tag it with the schema\'s scope - or, where a patch of the library gives an untagged resolver its scope, commit that patch where the package manager applies it.',
  'graphql-client-unread': () =>
    'The call hands its operation a GraphQL client this could not follow to the address it is made with, so the request is recorded with no address and joins no endpoint. Make the client with its uri written where it is made (new ApolloClient({ uri }), a factory handed { uri }), or hand it through a context provider whose value is one.',
  'graphql-document-dynamic': () =>
    'The GraphQL document is built at run time or is not written where it is used, so the fields it asks for cannot be joined. Write it as a gql template, a graphql() call or a .graphql file; a codegen document is read from the operation of its name in the documents its configuration lists, and a helper\'s from what each caller hands it.',
  'graphql-document-not-parsed': () =>
    'The document is not valid GraphQL, so nothing it asks for is joined; the server would refuse it too.',
  'graphql-fragment-not-read': () =>
    'The operation spreads a fragment that could not be read. Its root fields are joined; the fragment\'s fields are not compared with the schema.',
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
  'mcp-name-dynamic': () =>
    'An MCP server registers a tool, a prompt or a resource under a name decided at run time - usually a loop over a registry of them - so what a client may ask the server for is not drawn, or is drawn only as far as the source states it: a name written in part as a pattern, a name a record carries from the records the repository writes. Register each under a name written as text.',
  'route-registry-unread': () =>
    'One mount installs every application in a collection, and nothing here puts an application into that collection, so however many routes it installs are missing. Put them in a list, or register each on the application it is mounted on with a literal path.',

  // Trees of procedures (adapters-entry/procedure-routers)
  'procedure-unmounted': () =>
    'A tree of ways in, or one way in, is declared where no tree holds it, no mount serves it and nothing names it, so no request reaches it and it is not drawn. Informational: it is a branch somebody unhooked or never added. Add it to the tree the service serves, or delete it.',
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
  // Callers of procedures (adapters-entry/procedure-calls, in a browser and in a server)
  'procedure-path-dynamic': () =>
    'A step of the path a procedure is asked for by is computed, so the procedure it reaches cannot be named and the call is joined to nothing. Write each step as a name.',
  'entry-procedures-description-inactive': () =>
    'Ordinary in a project of several repositories. If this is the one it was written for, check the spelling of its packages.',
  // oRPC's links, mounts and contracts (P58)
  'procedure-link-dynamic': () =>
    'The link a client was made with works its address out when each request is sent, or is not one this reads, so nothing says which service it reaches; the join falls back to apiTarget. Write the URL as text, or as a setting followed by a path.',
  // A client's WebSocket link (P242)
  'procedure-link-socket': () =>
    'The request is sent over a WebSocket link, whose address belongs to the socket client and is not read, so the join falls back to the caller’s own service and apiTarget. Nothing is wrong; name the service the socket connects to in services[].apiTarget.',
  'procedure-prefix-unread': () =>
    'The mount that serves a tree is handed its requests somewhere this could not read the prefix of, so where it answers is unknown and, for an OpenAPI mount, none of the REST routes it answers is drawn. Hand the request to it in the file that builds it, with the prefix written as text.',
  'procedure-contract-unread': () =>
    'An implementation names a member of a contract this could not follow, so its input, output, errors and route are only what the implementation itself writes. Write the contract as object literals of chains the service can read, and check that the member exists.',

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
  'api-client-base-unread': () =>
    'A client instance is made with a base, or an interceptor or a hook run before every request sets one or rewrites the address, and it could not be read, was chosen by a branch, or two disagree. Requests through it were recorded under the base the instance is made with, or the path each call writes where it has none, and may join by their route alone. Write the base unconditionally, as a literal, a settings key or a constant.',
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
  'template-handler-not-found': () =>
    'The binding names a function the component neither declares nor imports, so the click runs nothing the graph can follow. Declare it, import it, or correct the name in the markup.',
  'component-unresolved': () =>
    "A tag in the markup names a component, and nothing the file imports or registers, and nothing the framework registers by the path of a file, has that name - or two files of one part of the application give it - so what the tag renders is not joined to the screen. Import the component, register it, or put it where the framework names components; a component of a package installed and registered for every template is said here too.",
  'layout-unresolved': () =>
    "A page is shown in a layout by a name no file of the application's layouts directories has, by a name written as code, or with no `<NuxtLayout>` in the root component to show it, so the layout's code is not on the page's way. Correct the name, write it as a literal, or render `<NuxtLayout>` in `app.vue`.",
  'route-middleware-unresolved': () =>
    "A page names a route middleware that no file of the application's middleware directories and no module gives, or names it by code, so what it runs before the page is not on the page's way. Correct the name, add the middleware, or write it as a literal.",
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
  'job-no-handler': () =>
    'A call adds a job to a queue under a name, and every handler of that queue names another job, so nothing runs it. Add a handler for it, or add it under the name a handler takes. Nothing to fix if its handler is in a repository the configuration does not name.',
  's3-write-matches-nothing': () =>
    'A write to a bucket fires an event that none of the bucket\'s notifications takes, by its events or by the start and end of the key. Nothing to fix if the write is meant to notify nobody; otherwise the notification\'s events or filters are not the ones meant.',
  'query-in-loop': () =>
    'A loop runs a query, cache call, HTTP call or publish once per item - directly, or through a function it calls - so a list of n items costs n round trips (likely N+1), listed by how many ways in reach it. Read every item in one call before the loop, or batch the calls; nothing to fix if the list is known to stay small. Loops bounded on purpose are set aside and counted in `flowatlas stats`: chunks, pages, cursors, retries, literal lists, loops around nothing but batch calls, migrations. A loop whose every query is a conditional write or a send to one recipient is a note. Name a chunking helper under callShape.boundedCalls, a guarded write under callShape.conditionalWrites, and a one-recipient host under callShape.perItemHosts.',
  'event-pattern-unread': () =>
    'A rule\'s event pattern is not read, so the rule is on no channel. Write it as JSON, a heredoc or jsonencode of what the files settle.',
  'api-body-unread': () =>
    'An API is created from an OpenAPI body that is not read, so none of its routes are drawn. Write the body as templatefile(), file(), jsonencode() or a heredoc, with a path the files settle and text that is JSON or YAML with paths.',
  'deployment-unread': () =>
    'The repository declares Lambda packages and no deployment description this reads. Functions are read from Terraform, a Serverless Framework file, an AWS CDK app in TypeScript, an AWS SAM template or a CloudFormation template; the handlers are still read as code, and nothing reaches them.',
  'nested-deployment-unread': () =>
    'A deployment nests another whose description is published somewhere else - an application of a registry, a template at a web or storage address - so nothing it declares is read. Keep the nested description in the repository and point at it by a relative path; one published elsewhere is read where its own repository is.',
  'layer-not-followed': () =>
    'Shared code is deployed as a layer that functions load when they run. Its sources are read as code where they are in the repository, but an import of the layer is not followed to them. Nothing to fix unless the calls into it matter; import it by a path or a package the repository resolves and they are followed.',
  'deployment-copy-not-read': () =>
    'A deployment description declares exactly what another one of the repository does, with uploads where the other names files of the repository: it is the copy a packaging step wrote, and it is read once, as the description it was written from. Nothing to fix; keep such copies out of the repository and this note goes too.',
  'deployment-app-unread': () =>
    'The program that declares the deployment was not read from its start - no cdk.json, an app that is not TypeScript, or a bound on how far it is followed - so what its stacks are handed is not known. Name a TypeScript app in cdk.json; the stacks are still read on their own.',
  'deployment-plugin-unread': () =>
    'A plugin or a macro of the deployment declares functions, queues or routes in a section of its own, or rewrites the description when it is deployed - or the description uses the types of one it does not name, such as the SAM transform - and what it adds is not read. Declare them in the description itself, name the transform it is written for, or expect them missing from the map.',
  'construct-repeated-unread': () =>
    'Something is declared once per element of a collection the files do not settle, so neither how many there are nor their names are known; one is read in their place. Write the collection out, or as a constant, and each is read under its own name.',
  'deployed-name-generated': () =>
    'The platform names this when it is deployed, so no file holds its name. It is named by where it is declared, which everything in the same deployment joins to; nothing outside it can. Give it a name of its own if other repositories reach it.',
  'deployed-name-from-parameter': () =>
    'A function, a queue, a stream, a table or a bus is named by a parameter of the template the files give no value. The value is the same wherever the parameter is written, so it is named by where the parameter is declared: everything in the deployment that points at it, or is handed the parameter, joins to it; nothing outside it can. Give the parameter a Default, a value in samconfig.toml, or one under services[].infra.options, and it is named by that value.',
  'construct-conditional': () =>
    'This is declared under a condition the files do not settle. It is read as declared, and what reaches it is drawn heuristic. Set the value the condition reads under services[].infra.options, or in the files.',
  'construct-unreached': () =>
    'This stack or construct is declared and never created by the program that deploys the others, so it is not read. Nothing to do unless it is deployed some other way.',

  // Joining the repositories (linker)
  'route-root-not-found': () =>
    'A route hangs from a point of an API that no configured service publishes, so its full path is not known. Add the repository that declares that API to the configuration.',
  'route-root-ambiguous': () =>
    'A route hangs from a point of an API that two declarations place differently. One of them is stale.',
  'export-not-found': () =>
    'A deployment reads a value another one publishes - an output, by the name it is exported under or by its stack and its own name - and no configured service publishes it, so what it names is not joined. Add the repository whose deployment declares that output to the configuration, or check the name on both sides.',
  'export-ambiguous': () =>
    'Two configured services publish a value under the same name, so a deployment reading it cannot be joined to either. A name is exported once where both are deployed; one of the two is stale, or they are two environments the configuration should tell apart.',
  'export-mismatched': () =>
    'A deployment reads a value another publishes, and that value is not read on the publishing side or is another kind of thing than the reader takes - a topic where a queue is read - so the two are not joined. Fix the output, or what reads it.',
  'parameter-file-ambiguous': () =>
    'A template has two sets of values, each its own - two parameter files beside it, two sceptre stacks or two commands launching one with values of their own, two rain commands naming it: the values of two deployments - and nothing says which one is deployed, so none is read and its parameters take their defaults. Name the one to read under services[].infra.vars (a parameter file, a stack configuration, or a var file a sceptre command is launched with), a sceptre group as services[].infra.options.config_env, or a file in its samconfig as parameter_overrides = "file://<file>".',
  'compose-service-unread': () =>
    'A composition of deployments lists a service that is not read: its folder is outside the repository, is not there, or holds no service file. Point it at a folder of the repository with a service file; one in another repository is read where that repository is.',
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
  'rule-matches-nothing': () =>
    'A side of an architecture rule names a service, tag, table, channel or route this graph does not hold, so the rule was not checked: a typo is never a pass. Correct the selector under rules[] in flowatlas.config.json (flowatlas rules --list says how many nodes each side selects).',
  'rule-invalid': () =>
    'An architecture rule does not match its schema: two shapes, none, an unknown key or a name that is not kebab-case. The configuration is refused until it is corrected; the message names the rule and the field.',
  'rule-over-partial-read': () =>
    'An architecture rule names a service the build read in part (skipped, or with packages not installed), so a crossing it makes may be missing from the answer. Install its dependencies and rebuild for a full answer.',
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
  'procedure-link-unserved': () =>
    'The client sends to an address where no mount of the protocol it speaks serves the tree, so nothing answers the request there. Point the link at the prefix the mount is handed, or mount the tree where the link sends.',
  'duplicate-node-id': () =>
    'Two repositories declared the same id. One of them was kept; rename the other, or split the shared file out into a package.',

  // An end that was declared rather than read (doctor/age.ts). Named after the
  // document and not after one format of it: there are two, and a reader with an
  // AsyncAPI document was being told something about OpenAPI. `RENAMED` above is
  // what keeps the old spelling working in a configuration that silenced it.
  'document-age': () =>
    'Nothing here can check a document against the running service, so how recently the document was updated is the only evidence there is that it is still true. Fetch the current one from whoever owns the service if it is behind.',

  // A store more than one service writes (doctor/shared-store.ts, P228), asked at doctor time.
  'store-shared': () =>
    'Two services write this store, so a change to its shape in one is a change under the other. If that is the design, accept it; if only one should write it, an `only` rule says so and flowatlas rules lists every other writer.',

  // A checkout that moved since the build (doctor/checkout.ts, P230), asked at doctor time.
  'checkout-moved': () =>
    'The graph describes the commit each repository was on when it was built. Run flowatlas build after a checkout or a merge, or flowatlas hook install to have it rebuilt in the background every time.',

  // What traffic answered beside what the code declares (doctor/runtime.ts, P106).
  // Asked of the observed file at doctor time, never stored in the graph.
  'failure-seen-undeclared': () =>
    'Real traffic got this status from the way in and no failure read off its code says it can: an unhandled throw, a constraint nobody mapped, a framework answer. Read a failing request (the MCP tool trace_for) and map the exception to the status it should answer, or declare it, and the route says what it really fails with.',
  'failure-declared-unseen': () =>
    'The code says the way in can fail with this and no request in the observed window answered it: an error path nothing exercised, or one that cannot happen any more. Traffic differs per environment and per week, so it is a question for a test, not proof the path is dead.',

  // What traffic reached and no reader drew (doctor/traffic.ts, P110): the
  // spans observe matched to nothing, one row per service and kind.
  'seen-not-in-code': () =>
    'Traffic reached this and no reader drew it: a route registered at run time, a service not in the configuration, or a reader gap. Look for it in the map (the MCP tool cant_follow names the call for each), add the service to the configuration if it is missing, and a later build that reads it makes the row go away. Nothing is drawn from it: a blind spot is a question, not an edge.',

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

/** Single-character edits between two words: insertions, deletions, substitutions. */
const editsBetween = (a: string, b: string): number => {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const swap = (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min((previous[j] as number) + 1, (current[j - 1] as number) + 1, swap));
    }
    previous = current;
  }
  return previous[b.length] as number;
};

/**
 * The reasons somebody probably meant by one nobody registered (P141): the
 * ones that contain it, or that it contains, then the ones a few edits away,
 * closest first. At most `limit`; none when nothing is close.
 */
export const nearestReasons = (text: string, known: readonly string[] = KNOWN_REASONS, limit = 5): string[] => {
  const wanted = text.toLowerCase();
  const near = Math.max(2, Math.floor(wanted.length / 3));
  return known
    .map((reason) => {
      const contains = reason.includes(wanted) || wanted.includes(reason);
      return { reason, score: contains ? 0 : editsBetween(wanted, reason) };
    })
    .filter((entry) => entry.score <= near)
    .sort((a, b) => a.score - b.score || (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0))
    .slice(0, limit)
    .map((entry) => entry.reason);
};

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
  'graphql-field-resolved-twice': ['GraphQL field resolved twice', 'GraphQL fields resolved twice'],
  'graphql-composition-conflict': ['federated field composition refuses', 'federated fields composition refuses'],
  'graphql-supergraph-drift': ['supergraph field out of date', 'supergraph fields out of date'],
  'graphql-auth-not-checked': ['gateway that checks no authorization directive', 'gateways that check no authorization directive'],
  'graphql-entity-type-unsaid': ['entity interface no subgraph can type', 'entity interfaces no subgraph can type'],
  'graphql-requires-auth-not-carried': ['@requires field missing a required field\'s check', '@requires fields missing a required field\'s check'],
  'route-file-not-served': ['route file served at no address', 'route files served at no address'],
  'wizard-step-conflict': ['wizard step numbered twice', 'wizard steps numbered twice'],
  'workflow-name-duplicate': ['workflow defined twice', 'workflows defined twice'],
  'workflow-definition-invalid': ['workflow definition the service refuses', 'workflow definitions the service refuses'],
  'orphan-scene-decorator': ['scene handler outside a scene', 'scene handlers outside a scene'],
  'orphan-update-decorator': ['bot handler outside an update class', 'bot handlers outside an update class'],
  'procedure-call-mismatch': ['procedure called as the wrong kind', 'procedures called as the wrong kind'],
  'procedure-link-unserved': ['procedure sent where nothing answers', 'procedures sent where nothing answers'],
  'procedure-unmounted': ['procedure declared where nothing serves it', 'procedures declared where nothing serves them'],
  'network-port-unreachable': ['request to a port the network does not reach', 'requests to a port the network does not reach'],
  'server-request-without-origin': ['server request with no host', 'server requests with no host'],
  'release-need-undefined': ['release needing one nothing declares', 'releases needing one nothing declares'],
  's3-write-matches-nothing': ['bucket write no notification takes', 'bucket writes no notification takes'],
  'job-no-handler': ['job no handler of its queue takes', 'jobs no handler of their queue takes'],
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
