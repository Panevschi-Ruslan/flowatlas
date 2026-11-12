import type { EntryKind, EntryProcedureConfig, EntryProcedureDescription } from '@flowatlas/core';
import { entryProcedureSchema } from '@flowatlas/core';

/**
 * The frameworks whose ways in are the keys of a tree, described rather than
 * implemented.
 *
 * This sits beside `route-dialects.ts` and is a second file rather than four more
 * fields on the first, and the reason is worth stating because the pull was the
 * other way. Every framework in that file names a way in with a *string at an
 * argument position*: `app.get('/users', …)`, `registry.register('confirm', …)`.
 * Every field it has — `pathArg`, `keyArg`, `pathMethod`, `prefixOption` — is an
 * answer to "where among the arguments is the name". A tree of procedures has no
 * such argument. The name is the key the value is written under, the address is
 * every key above it, and the thing that produces an address is a walk rather
 * than a lookup. There is no spelling of `pathArg` that means "the key of the
 * enclosing object literal", and inventing one would have put a field on the HTTP
 * description that four real frameworks cannot use and one cannot be read
 * without a different reader anyway.
 *
 * So: a description of its own, and one walk over it. What stayed in the walk is
 * only what is true of every such framework — that an object literal's keys name
 * its members, that a nested literal or a named tree extends the address, that a
 * chain's last link is what decides whether a value is a way in at all. What is
 * in the row is every name and every position: which functions assemble a tree,
 * which methods end a chain and what each of them means, which link carries the
 * shape a caller sends, which link installs a guard, and where a tree is hung so
 * that requests reach it.
 *
 * The row below goes in through `entryProcedureSchema`, exactly as the HTTP rows
 * go in through theirs, so what ships is proof the description can say what a
 * real framework needs rather than a claim that it can.
 */

/** Where a tree is hung so that requests reach it. */
export interface ProcedureMount {
  /** The function that turns a tree into something requests arrive at. */
  readonly call: string;
  /** Which argument carries the tree, when it is the argument itself. */
  readonly treeAt: number;
  /** The key of an options argument that carries the tree, when it is one. */
  readonly treeKey?: string;
  /** Built with `new` rather than called (P58). */
  readonly constructed: boolean;
  /** Also answers each way in at its own HTTP route (P58). */
  readonly routes: boolean;
  /** Where the address it answers under is written: an option of a method called on what it made (P58). */
  readonly prefixFrom?: { readonly method: string; readonly key: string; readonly arg: number };
  /** The key of its own options naming the address it answers under (P247). */
  readonly prefixKey?: string;
  /** The address where its options name none under `prefixKey` (P247). */
  readonly prefixDefault?: string;
  /** The address is the path argument of the call it is handed to (P247). */
  readonly handedTo?: { readonly method: string; readonly pathAt: number };
  /** The address is the file's own route, its last parameter taken off (P247). */
  readonly fileRoute: boolean;
  /** A plugin handed uncalled as argument `at` of a `method` call, whose arguments are its own (P256). */
  readonly plugin?: { readonly method: string; readonly at: number };
  /** What its protocol is called in `meta.mounted` (P58). */
  readonly protocol?: string;
}

export interface ProcedureDialect {
  /** The adapter's name, as it appears in `meta.adapter` and in every row. */
  readonly name: string;
  /** Dependencies any one of which means this framework is in use. */
  readonly packages: readonly string[];
  /** Functions that assemble a tree out of one object literal. */
  readonly assembledBy: readonly string[];
  /**
   * The last link of a chain, and the kind of way in it opens.
   *
   * A `Map`, because it is asked about the last method of every value in a
   * tree, and an object answers `toString` with the language's own function
   * where a kind belongs (R130).
   */
  readonly terminators: ReadonlyMap<string, EntryKind>;
  /** How the keys down the tree are joined into one address. */
  readonly separator: string;
  /** The chain link carrying the shape of what a caller sends. */
  readonly inputMethod?: string;
  /** The chain link that installs something in front of a way in. */
  readonly guardMethod?: string;
  /** Where the context's type is written, and the key a function is handed it under. */
  readonly context?: { readonly method: string; readonly key: string };
  /** Every place a tree is hung. */
  readonly mounts: readonly ProcedureMount[];
  /** Whether an object literal is a tree with no call around it (P58). */
  readonly plainTrees: boolean;
  /** Functions handed a contract, whose property accesses name its members (P58). */
  readonly implementedBy: readonly string[];
  /** The chain link carrying the shape a way in answers with (P58). */
  readonly outputMethod?: string;
  /** The chain link declaring the failures a way in may answer with (P58). */
  readonly errorsMethod?: string;
  /** The chain link giving a way in its own HTTP route (P58). */
  readonly routeMethod?: string;
  /** The link on a tree's assembling call that prefixes every route under it (P58). */
  readonly prefixMethod?: string;
  /** Functions that load a tree from a module when it is first asked for (P58). */
  readonly lazyBy: readonly string[];
}

const mountOf = (mount: EntryProcedureConfig['mounts'][number]): ProcedureMount => ({
  call: mount.call,
  treeAt: mount.treeArg,
  ...(mount.treeKey === undefined ? {} : { treeKey: mount.treeKey }),
  constructed: mount.constructed,
  routes: mount.routes,
  ...(mount.prefixFrom === undefined ? {} : { prefixFrom: { ...mount.prefixFrom } }),
  ...(mount.prefixKey === undefined ? {} : { prefixKey: mount.prefixKey }),
  ...(mount.prefixDefault === undefined ? {} : { prefixDefault: mount.prefixDefault }),
  ...(mount.handedTo === undefined ? {} : { handedTo: { ...mount.handedTo } }),
  fileRoute: mount.fileRoute,
  ...(mount.plugin === undefined ? {} : { plugin: { ...mount.plugin } }),
  ...(mount.protocol === undefined ? {} : { protocol: mount.protocol }),
});

/**
 * The dialect a description stands for.
 *
 * The one place a description becomes something the reader can use, and the
 * whole of what would separate a framework shipped with the tool from one a
 * person wrote a row for. Two spellings differ for the same reason they differ
 * next door: configuration says `treeArg`, because that is what every other
 * description in this tool calls an argument position, and the dialect says
 * `treeAt`, because that is what the readers have always called them.
 */
export const procedureDialectOf = (config: EntryProcedureConfig): ProcedureDialect => ({
  name: config.name,
  packages: config.packages,
  assembledBy: config.assembledBy,
  terminators: new Map(Object.entries(config.terminators)),
  separator: config.separator,
  ...(config.inputMethod === undefined ? {} : { inputMethod: config.inputMethod }),
  ...(config.guardMethod === undefined ? {} : { guardMethod: config.guardMethod }),
  ...(config.context === undefined ? {} : { context: { ...config.context } }),
  mounts: config.mounts.map(mountOf),
  plainTrees: config.plainTrees,
  implementedBy: config.implementedBy,
  lazyBy: config.lazyBy,
  ...(config.outputMethod === undefined ? {} : { outputMethod: config.outputMethod }),
  ...(config.errorsMethod === undefined ? {} : { errorsMethod: config.errorsMethod }),
  ...(config.routeMethod === undefined ? {} : { routeMethod: config.routeMethod }),
  ...(config.prefixMethod === undefined ? {} : { prefixMethod: config.prefixMethod }),
});

/** A dialect shipped with the tool, written as a description and validated as one. */
const described = (description: EntryProcedureDescription): ProcedureDialect =>
  procedureDialectOf(entryProcedureSchema.parse(description));

/**
 * tRPC, and the framework the description was written to fit.
 *
 * `assembledBy` names functions rather than types, and that is the one place this
 * description is looser than the HTTP ones, which insist on the type of the
 * receiver. It is deliberate and it is forced. The builder a repository calls is
 * almost never the library's: `initTRPC.create()` hands back an object, the
 * project takes it apart — `export const router = t.router` — and every router
 * in the repository is then assembled by a function of the project's own, in the
 * project's own file, with the project's own type. A scheduling app does exactly this,
 * and a row naming `@trpc/server#TRPCRouterBuilder` would have matched none of
 * its thirty-three routers. Matching on the name is what actually finds them.
 *
 * What makes the looseness safe is that the name is never enough on its own. A
 * call is a tree only once one of its literal's values turns out to be a
 * procedure, and a value is a procedure only when it is a chain whose last link
 * is `query`, `mutation` or `subscription` and whose argument is a function.
 * That shape is not written by accident, and requiring it means a project with
 * an unrelated `router({ … })` of its own produces nothing rather than a tree of
 * ways in that do not exist.
 *
 * It also means the reading needs no types at all, which is the difference
 * between reading a repository and reading an installed one. Every HTTP dialect
 * here is blind in a fresh clone, because the type on the receiver is the only
 * thing separating a route from any other call; this one reads the same tree
 * either way.
 *
 * `guardMethod` is read on the chain and on whatever the chain starts from, and
 * the second half is where the guards actually are. Nobody writes
 * `procedure.use(isAuthed).query(…)` at every way in; they write
 * `const authedProcedure = procedure.use(perf).use(errors).use(isAuthed)` once
 * and start every guarded chain from that name.
 *
 * `mounts` exists for the sentence in the ticket rather than for an address.
 * Twenty-nine three-line files under `pages/api` are what serves a scheduling app's tree,
 * and the address a caller actually writes is the procedure's path, not the URL
 * of whichever of those files the client's link happens to pick. So the mount is
 * not read for a path; it is read so that a file which serves a tree nobody
 * could follow says so, naming itself.
 */
export const TRPC: ProcedureDialect = described({
  name: 'trpc-procedures',
  packages: ['@trpc/server'],
  // `createTRPCRouter` is the name the framework's own scaffolding writes, and
  // `router` and `createRouter` are what a project that re-exports the builder
  // calls it. `mergeRouters` is deliberately not here: it assembles from several
  // trees rather than from one literal, so the walk would not read it, and a
  // name in a row that the reader cannot act on is worse than an absent one —
  // a repository written that way gets the row saying no tree was read, which is
  // true, instead of a row saying one was.
  assembledBy: ['router', 'createTRPCRouter', 'createRouter'],
  // A query reads and a mutation writes, and both are a request a caller waits
  // for an answer to, so both are the kind this model already has for that. A
  // subscription is a stream: nobody waits for one answer, and calling it `rpc`
  // would put it in the same bucket as the two that are.
  terminators: { query: 'rpc', mutation: 'rpc', subscription: 'event' },
  inputMethod: 'input',
  guardMethod: 'use',
  // `initTRPC.context<Context>().create()` is where a project writes what every
  // procedure's `ctx` is, and it is the only place: a handler written
  // `async ({ ctx }) => …` states nothing, and with nothing installed the
  // checker has no tRPC to carry the type across. A scheduling app's three read-gate
  // files that query through `ctx.prisma` were unread for exactly that (R157).
  context: { method: 'context', key: 'ctx' },
  //
  // Each says where it answers (P247), so a client's link can be checked
  // against it as an oRPC one is: a Next.js handler by the file it is in, the
  // fetch adapter by its `endpoint` (or its file), the Express middleware by
  // the `use` call it is handed to, the standalone server by its `basePath`.
  mounts: [
    // The Next.js adapter, and the one a scheduling app wraps under the same name. The
    // library's own spelling hands it an options object; a project's wrapper
    // usually takes the tree alone, so both are accepted on one row.
    { call: 'createNextApiHandler', treeKey: 'router', protocol: 'trpc', fileRoute: true },
    { call: 'fetchRequestHandler', treeKey: 'router', protocol: 'trpc', prefixKey: 'endpoint', fileRoute: true },
    { call: 'createExpressMiddleware', treeKey: 'router', protocol: 'trpc', handedTo: { method: 'use', pathAt: 0 } },
    { call: 'createHTTPHandler', treeKey: 'router', protocol: 'trpc', prefixKey: 'basePath', prefixDefault: '/' },
    { call: 'createHTTPServer', treeKey: 'router', protocol: 'trpc', prefixKey: 'basePath', prefixDefault: '/' },
    { call: 'createNextRouteHandler', treeKey: 'router', protocol: 'trpc', fileRoute: true },
    // Fastify's adapter is a plugin the repository hands to `register` with
    // its options, never calls (P256): the tree is under `trpcOptions`, the
    // address is the plugin's `prefix`, the root without one.
    {
      call: 'fastifyTRPCPlugin',
      plugin: { method: 'register', at: 0 },
      treeArg: 1,
      treeKey: 'trpcOptions.router',
      protocol: 'trpc',
      prefixKey: 'prefix',
      prefixDefault: '/',
    },
    // Hono's middleware (`@hono/trpc-server`), answering under its `endpoint`,
    // `/trpc` where it names none (P256).
    { call: 'trpcServer', treeKey: 'router', protocol: 'trpc', prefixKey: 'endpoint', prefixDefault: '/trpc' },
  ],
});

/**
 * oRPC, the second of the family, and the row that taught the description six
 * more words (P58).
 *
 * The walk is tRPC's; what differs is said here. A procedure ends in `handler`
 * and nothing else: the server does not declare a query or a mutation, the
 * client chooses, so the one ending is `rpc`. A router is any object whose
 * values are procedures - `os.router({...})` only installs middleware or a
 * prefix on one - so plain literals are trees. A contract-first service writes
 * its input, output, errors and route on a contract and implements it with
 * `implement(contract)`, whose property accesses name the contract's members.
 * `.errors({...})` declares the failures a procedure answers with, and
 * `.route({ method, path })` its REST route, which an OpenAPI handler serves
 * beside the RPC one at the prefix its `handle` call is given.
 */
export const ORPC: ProcedureDialect = described({
  name: 'orpc-procedures',
  packages: ['@orpc/server'],
  // `os.router(...)`, and `oc.router(...)` for a contract, which is assembled
  // the same way and is never confirmed a tree: none of its members ends in a
  // handler.
  assembledBy: ['router'],
  terminators: { handler: 'rpc' },
  inputMethod: 'input',
  outputMethod: 'output',
  guardMethod: 'use',
  errorsMethod: 'errors',
  routeMethod: 'route',
  prefixMethod: 'prefix',
  plainTrees: true,
  implementedBy: ['implement'],
  lazyBy: ['lazy'],
  context: { method: '$context', key: 'context' },
  mounts: [
    // A handler object built once from the tree, from any of the adapters'
    // entry points, answering under the prefix its `handle` call is given.
    // Only the OpenAPI one answers a procedure at a REST route of its own.
    {
      call: 'RPCHandler',
      treeArg: 0,
      constructed: true,
      protocol: 'rpc',
      prefixFrom: { method: 'handle', key: 'prefix', arg: 1 },
    },
    {
      call: 'OpenAPIHandler',
      treeArg: 0,
      constructed: true,
      routes: true,
      protocol: 'openapi',
      prefixFrom: { method: 'handle', key: 'prefix', arg: 1 },
    },
  ],
});

/** Every framework whose ways in are the keys of a tree. */
export const PROCEDURE_DIALECTS: readonly ProcedureDialect[] = [TRPC, ORPC];
