import {
  HTTP_METHODS,
  namedFunction,
  normalizePath,
  originOfValue,
  PARAM_PLACEHOLDER,
  reachOf,
  type ExtractContext,
  type NamedFunction,
  type Reach,
} from '@flowatlas/core';
import type { Node as TsNode, SourceFile } from 'ts-morph';
import { Node } from 'ts-morph';
import { builtExportFunction, repoFunctionOf, unwrapValue } from './shared.js';

/**
 * A router whose address space is the file system, described rather than
 * implemented.
 *
 * Every framework this tool reads by call site registers a route by calling
 * something: a decorator, a method on an application, an entry in a table. There
 * is always a call, and the path is an argument to it. Here there is no call at
 * all. `app/api/orders/[id]/route.ts` is served at `/api/orders/:id`, and
 * `src/api/admin/orders/[id]/route.ts` at `/admin/orders/:id`, because of where
 * the file is; nothing inside either file says so. So a reader for one of these
 * is not a reader of expressions but a reader of paths.
 *
 * **Two of them are one thing.** This started as the Next.js reader and was
 * generalised when Medusa needed the same job done (R91). What the two
 * frameworks disagree about is four facts, and every one of them is a value:
 * which directory is the root, which file names declare a route rather than
 * contribute a segment, what prefix stands in front of everything, and which of
 * the segment spellings below the router honours. What they agree about is the
 * whole of the reading — walk the directories, drop the segments that are not
 * addresses, turn the rest into a path, then read the verbs the file exports.
 * A second implementation of that would agree with this one today and disagree
 * the first time either was touched, which is the defect this project spent a
 * batch removing (R115). So Medusa's router is a row of data beside Next's, and
 * a third is another row.
 */
export interface FsRouter {
  /** The directory whose contents are the address space. */
  readonly root: string;
  /**
   * File names that declare a route rather than contribute a segment.
   *
   * Both `route.ts` conventions name them; the Pages Router has none, because
   * there every file is a route and its own name is the last segment.
   */
  readonly routeFiles?: readonly string[];
  /** A prefix every address under this router carries. */
  readonly prefix?: string;
  /**
   * Which of the segment spellings below this router honours.
   *
   * Named rather than assumed, because the spellings are not a superset of one
   * another and applying one router's to another's tree moves addresses. Medusa
   * skips a segment that starts with an underscore and turns `[id]` into a
   * parameter, and does neither of the other three: a directory it happens to
   * call `(admin)` is a literal segment of the address, and reading it as a
   * group that drops out would move every route under it.
   */
  readonly segments: readonly SegmentConvention[];
}

/**
 * One way a directory name can mean something other than itself.
 *
 * A closed set on purpose. These are the spellings the file-system routers this
 * tool reads have between them, and a framework with a fifth adds a name here
 * and a rule to the table below, which is one place rather than two files.
 */
export type SegmentConvention = 'group' | 'slot' | 'private' | 'param' | 'catch-all';

/** A directory that groups files without appearing in the address. */
const GROUP = /^\(.*\)$/;

/** A slot of a layout rendered beside another, which is not a path either. */
const SLOT = /^@/;

/**
 * A folder the router refuses to serve.
 *
 * The underscore is a router's own way of saying "this is code, not a route",
 * and it is how a repository keeps components or helpers next to the routes that
 * use them without those files becoming addresses. Both routers read here have
 * it, and they arrived at it independently.
 */
const PRIVATE = /^_/;

/** `[id]` is one segment of any value; `[...rest]` and `[[...rest]]` are any number. */
const DYNAMIC = /^\[(\.\.\.)?(.+?)\]$/;
const OPTIONAL_CATCH_ALL = /^\[\[\.\.\..+\]\]$/;

/**
 * What one segment contributes to an address, by the convention that claims it.
 *
 * A lookup rather than a chain of branches, so that a router's `segments` list
 * is the whole of what decides which spellings apply to it. Each rule answers
 * `undefined` when the segment is not its business, `null` when the segment
 * contributes nothing, and a string when it contributes that.
 *
 * `null` is a different answer from an empty string: a repository that spells a
 * group as a path serves `app/api/(admin)/users/route.ts` at `/api/users`, and
 * getting that wrong moves every route under it.
 */
const SEGMENT_RULES: Readonly<
  Record<SegmentConvention, (segment: string) => string | null | undefined>
> = Object.freeze({
  group: (segment) => (GROUP.test(segment) ? null : undefined),
  slot: (segment) => (SLOT.test(segment) ? null : undefined),
  // Not a segment that drops out but a segment that cancels the route; the walk
  // below asks about this one separately and this rule exists so that a router
  // which does not honour underscores is not read as if it did.
  private: (segment) => (PRIVATE.test(segment) ? null : undefined),
  'catch-all': (segment) => {
    if (OPTIONAL_CATCH_ALL.test(segment)) return '*';
    const dynamic = DYNAMIC.exec(segment);
    return dynamic !== null && dynamic[1] !== undefined ? '*' : undefined;
  },
  param: (segment) => {
    const dynamic = DYNAMIC.exec(segment);
    return dynamic !== null && dynamic[1] === undefined ? PARAM_PLACEHOLDER : undefined;
  },
});

/** The conventions, in the order a segment is offered to them. */
const CONVENTION_ORDER: readonly SegmentConvention[] = [
  'group',
  'slot',
  'private',
  'catch-all',
  'param',
];

/** One segment of a directory path, as this router reads it. */
const segmentOf = (segment: string, router: FsRouter): string | null => {
  if (segment === '') return null;
  for (const convention of CONVENTION_ORDER) {
    if (!router.segments.includes(convention)) continue;
    const read = SEGMENT_RULES[convention](segment);
    if (read !== undefined) return read;
  }
  return segment;
};

/** Whether a segment opts its whole subtree out of routing, for this router. */
const optsOut = (segment: string, router: FsRouter): boolean =>
  router.segments.includes('private') && PRIVATE.test(segment);

const FILE_EXTENSION = /\.[cm]?[jt]sx?$/;

/**
 * The directory a framework's own convention allows between a package and its
 * application, which is part of neither the package's path nor the address.
 */
const SOURCE_DIRECTORY = 'src';

/**
 * Where an application begins, and what stands in front of everything it serves.
 *
 * A repository may hold more than one application, and the ones that do are not
 * exotic: payload keeps thirty-nine of them under `test/`, `templates/` and
 * `examples/`, each a whole Next.js application with its own `app/` directory.
 * Every one of those declares `api/[...slug]/route.ts`, so reading the router
 * root wherever it occurs and nothing in front of it made two hundred and
 * seventy-one route declarations claim the seventeen addresses their names
 * collide on, and the graph kept whichever arrived last. Seventeen of two
 * hundred and eighty-eight, and the arithmetic said nothing was missing.
 *
 * So the segments in front of the router root are kept, and they are what tells
 * one application from another. The address of a route in the application at the
 * service's own root is exactly what the framework serves it at, which is the
 * common case and the one every existing reading depends on. A route in an
 * application somewhere below is addressed from where that application is —
 * `/test/fields/api/*` rather than a second claim on `/api/*` — because those
 * two are never deployed together and a graph that merged them would say one
 * address is answered by thirty bodies.
 *
 * `src` drops out, because a framework may allow an application to sit either at
 * a package's root or under `src` and serves both at the same addresses. Where
 * the router's root already names `src` there is nothing in front of it to drop.
 */
const applicationPrefix = (before: readonly string[]): string => {
  const kept = [...before];
  if (kept[kept.length - 1] === SOURCE_DIRECTORY) kept.pop();
  return kept.length === 0 ? '' : `/${kept.join('/')}`;
};

/**
 * The address a file is served at, or `null` when this router does not serve it.
 *
 * `file` is repo-relative and POSIX, as every path in the graph is. A path that
 * climbs out of the service — a file of a workspace package the service reads —
 * is served by nothing: a library has no address space of its own, and an
 * application inside one belongs to whichever service is that package.
 *
 * The root is matched wherever it occurs rather than only at the start, because
 * a repository is as likely to keep its application under `src/` as at the top.
 * The first occurrence is the one taken: an application whose own directories
 * include one called `app` has that inner one as an ordinary segment of its
 * addresses, and taking the last would both lose it and mistake it for a second
 * application.
 */
export const routePathOfFile = (file: string, router: FsRouter): string | null => {
  if (file.startsWith('../')) return null;
  const parts = file.split('/');
  const rootParts = router.root.split('/');
  let at = -1;
  for (let index = 0; index + rootParts.length <= parts.length && at < 0; index += 1) {
    if (rootParts.every((part, offset) => parts[index + offset] === part)) at = index;
  }
  if (at < 0) return null;

  const prefix = applicationPrefix(parts.slice(0, at));
  const after = parts.slice(at + rootParts.length);
  const name = (after.pop() ?? '').replace(FILE_EXTENSION, '');
  if (name === '') return null;

  if (router.routeFiles !== undefined) {
    if (!router.routeFiles.includes(name)) return null;
  } else {
    // The older router: the file name is the last segment, and a private file
    // is not a route at all.
    if (optsOut(name, router)) return null;
    if (name !== 'index') after.push(name);
  }

  // A directory the underscore opts out of routing serves nothing at all, so a
  // file under one is not a route with a segment missing — it is not a route.
  if (after.some((segment) => optsOut(segment, router))) return null;

  // A grouped or slot directory drops out; nothing else may, because a segment
  // that could not be read would make the address a different one.
  const kept = after
    .map((segment) => segmentOf(segment, router))
    .filter((segment): segment is string => segment !== null);
  return normalizePath(`${prefix}${router.prefix ?? ''}/${kept.join('/')}`);
};

/**
 * How far a path pattern reaches, as a test on a path.
 *
 * `undefined` means the pattern could not be read, which is the common case and
 * deliberately not the same as "it does not cover this route". A framework that
 * accepts a full regular expression here has repositories that use one — the
 * canonical example in Next.js's own documentation is a negative lookahead, and
 * Medusa's middleware `matcher` is typed `string | RegExp`. Claiming a route is
 * guarded because an expression nobody read might have matched it would be the
 * worst thing this tool could say.
 *
 * Shared by both readers, because "does this pattern cover this address" is one
 * question however the pattern was written down, and two answers to it would
 * disagree about which routes a guard reaches.
 */
export const pathPatternTest = (pattern: string): ((path: string) => boolean) | undefined => {
  if (!pattern.startsWith('/')) return undefined;
  if (/[()|?!]/.test(pattern)) return undefined;
  const expression = pattern
    .split('/')
    .map((segment) => {
      if (segment === '') return '';
      if (segment.startsWith(':')) return segment.endsWith('*') ? '.*' : '[^/]+';
      if (segment === '*') return '.*';
      // A star inside a segment is any run of characters from there on, which is
      // how `/admin*` is written and meant. Escaping everything but the star and
      // leaving the star to the regular expression read it as "zero or more of
      // the letter before it", so `/admin*` covered `/admi` and not `/admin/x`.
      return segment.replace(/[.+^${}[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    })
    .join('/');
  const compiled = new RegExp(`^${expression}$`);
  return (path) => compiled.test(path);
};

/**
 * What a verb export stands for, and whether there is code behind it.
 *
 * The two facts travel together because only the reading that answered knows the
 * second one. A `NamedFunction` carries a `body`, and what that body is depends
 * on which reading produced it — the function's own body, or the call that built
 * the value. Asking the question afterwards, of the body alone, cannot tell the
 * difference: `async () => Response.json(x)` has a call for a body and was read
 * in full, and `restHandler(config)` has a call for a body and was not read at
 * all.
 */
export interface VerbReading {
  fn: NamedFunction;
  /** False when the node points at a call that was handed nothing to read. */
  bodyRead: boolean;
}

/** The named function a declaration stands for, wherever it was exported from. */
const exportedFunction = (declaration: TsNode): NamedFunction | undefined =>
  namedFunction(declaration);

/** How far a verb written as another verb's name is followed. */
const ALIAS_DEPTH = 4;

/**
 * The verb an aliased verb stands for.
 *
 * `export const PUT = PATCH;` is how a repository keeps an old spelling of a
 * route working, and `export const POST = GET;` is how one answers a scheduled
 * job whichever way the scheduler calls it. The initializer is a name rather
 * than a call, so the two readings in `verbReading` both decline it and are
 * right to: the module declares no function here and built nothing either. But
 * the verb it names is in the graph already, with a node of its own, and
 * pointing both ways in at that one node is the whole of what the code says.
 *
 * The name is resolved rather than looked up in this file, because an alias is
 * free to name a verb another module exports, and the node the target has is
 * the one in the file it was declared in. Whatever the name resolves to is then
 * read as a verb in its own right, so an alias of a built export reaches the
 * built export's function; a chain is followed a few links and then abandoned,
 * which also settles the mutually aliased pair nobody writes on purpose.
 */
const aliasedFunction = (declaration: TsNode, depth: number): VerbReading | undefined => {
  if (depth >= ALIAS_DEPTH) return undefined;
  if (!Node.isVariableDeclaration(declaration)) return undefined;
  const initializer = declaration.getInitializer();
  if (initializer === undefined) return undefined;
  const value = unwrapValue(initializer);
  if (!Node.isIdentifier(value)) return undefined;
  const origin = originOfValue(value);
  // A name that resolves into a package is that package's function, and this
  // repository has no node for it to point at.
  return origin.kind === 'local' ? verbReading(origin.declaration, depth + 1) : undefined;
};

/**
 * Whether a call that built a verb was handed anything to read.
 *
 * A verb exported as the value a call handed back is read as a function by
 * `builtExportFunction`, and the node it produces points at the call. That is
 * right when the call was handed the work — `withAdmin(async () => …)` has the
 * handler written inside it — and it is a hollow node when the call was handed
 * nothing this repository declares: `export const GET = REST_GET(config)` is a
 * way in whose body lives in a package, and an entry pointing at it says a
 * handler was read when none was.
 *
 * That distinction is the whole of R94. A route with no verb at all already had
 * a row; a verb whose body could not be followed produced an entry, sometimes a
 * `handles` edge onto a node with nothing in it, and no row at all — so a
 * repository where every handler is assembled by a helper reported full coverage
 * of routes nobody had read: seventeen of seventeen, where two of nine reached a
 * body that calls anything.
 *
 * What counts as work: a function written in the call, or an argument that
 * resolves to a function declared in this repository. Nothing else is followed,
 * because anything else is the same guess in a longer form.
 */
const callHandedWork = (body: TsNode): boolean => {
  if (!Node.isCallExpression(body)) return true;
  return body.getArguments().some((argument) => {
    const value = unwrapValue(argument);
    return (
      Node.isArrowFunction(value) ||
      Node.isFunctionExpression(value) ||
      repoFunctionOf(value) !== undefined
    );
  });
};

/**
 * What a verb export stands for: a function written here, one a call built, or
 * another verb's name.
 *
 * One reading for every file-system router, which is the point of it being here.
 * The three spellings are not one framework's fact — a wrapper round a handler,
 * and a verb aliased to another, are how anybody writes these — and two readers
 * with two answers would disagree about which routes have a body behind them,
 * which is the number the coverage report is built on.
 *
 * `export const GET = withWorkspace(async (req) => { … })` is a route handler and
 * reads as no function at all by `namedFunction` alone, because what the module
 * declares is a value. Every entry in such a file was correct — the route, the
 * verb and the path are all read from where the file is — and none of them had
 * anything behind it, so nothing on the far side of the boundary was attached to
 * the way in (R72). `builtExportFunction` is the reading the React function index
 * uses to give that export a node, shared rather than written again, because two
 * rules for what the function behind an export is would name two different things
 * within a release. That shared reading also covers the two other spellings a
 * large repository uses — a value bound to a local name and re-exported under a
 * verb's, and a verb taken out of an object a call handed back
 * (`export const { POST } = serve(…)`) — and it covers them on both sides at
 * once, which is the only way it is worth covering them: an adapter that named a
 * function the index had no node for would draw an edge to nothing. The third
 * spelling, a verb written as another verb's name, needs nothing of the index,
 * because the verb it names already has the node.
 *
 * Deliberately not folded into `namedFunction` itself, which the server-action
 * reader also uses: there, an export that is not a function written in place is
 * the signal to read the builder chain, which names the action inside the call
 * and records which library built it. That is a finer answer than this one and it
 * would be lost if this rule answered first.
 */
export const verbReading = (declaration: TsNode, depth = 0): VerbReading | undefined => {
  const written = exportedFunction(declaration);
  // A function declared here: its body is the body, and there is nothing to
  // doubt about whether it was read.
  if (written !== undefined) return { fn: written, bodyRead: true };
  const built = builtExportFunction(declaration);
  // A value a call handed back: what the node points at is the call, so whether
  // anything was read depends on what the call was handed.
  if (built !== undefined) return { fn: built, bodyRead: callHandedWork(built.body) };
  return aliasedFunction(declaration, depth);
};

/**
 * Why one verb's body was not read, and what to do about it.
 *
 * A lookup rather than a pair of branches, because the two cases differ only in
 * the sentence they say: one reading decides which of them applies, and adding a
 * third spelling should be adding an entry here.
 */
const UNREAD_HANDLER: Readonly<Record<'none' | 'built', (where: string) => string>> = Object.freeze({
  none: (where) =>
    `${where} is exported and nothing this could read is behind it, so the way in has no handler.`,
  built: (where) =>
    `${where} is the value a call handed back, and nothing declared in this repository was handed to that call, so the way in has no handler that could be read.`,
});

/**
 * A verb that is there and whose body is not.
 *
 * One row per verb rather than one folded row for the repository, which is the
 * opposite of the choice made for unreadable server actions, and the difference
 * is what the number is for. An action a builder made is a limit of this tool,
 * said once. A route whose body was not read is a hole in the coverage of that
 * one route, and how many there are against how many routes were found is the
 * only honest way to read the summary, so each one is a place (R94).
 */
export const reportUnreadHandler = (
  ctx: ExtractContext,
  options: {
    file: string;
    line: number;
    label: string;
    path: string;
    why: 'none' | 'built';
    adapter: string;
  },
): void => {
  ctx.builder.addUnresolved({
    file: options.file,
    line: options.line,
    reason: 'route-handler-unread',
    message: `${UNREAD_HANDLER[options.why](options.label)} It answers at ${options.path}.`,
    hint: 'Export the handler as a function declared here, or hand the work to the wrapper as a function this repository declares, so the code behind the route can be pointed at.',
    symbol: options.label,
    adapter: options.adapter,
  });
};

/** One way in a file-system router declares, as the reader of one describes it. */
export interface FsRouteVerb {
  method: string;
  path: string;
  /**
   * Where the way in was found, and where its verb was written.
   *
   * One value rather than a `file` and a `line`. A verb resolved across modules
   * has its declaration in whichever file wrote it, and only the route file's own
   * line belongs beside the route file's path; passing halves of two answers is
   * how `file:line` came to land nowhere (R99).
   */
  at: Reach;
  handler?: NamedFunction;
  /** False when a handler was named and there is nothing behind the name. */
  bodyRead: boolean;
}

/**
 * The verbs one route file exports, each of them one way in.
 *
 * The whole of what a directory-addressed route file says, and it says it the
 * same way in both frameworks: the address came from the path, and the verbs are
 * the names of the exports. What the caller does with each one differs — what
 * stands in front of it, which adapter's name goes on it — so the entry is built
 * by the caller and this hands over the four facts it read.
 *
 * Asked of the compiler rather than of the statements, so that the three shapes
 * a real repository writes all answer: a function declared here, a name
 * re-exported under a verb's name, and a whole module re-exported from somewhere
 * else. In the Next.js repository this was measured against, twenty-six of the
 * five hundred and twenty route files are one of the last two.
 */
export const readVerbFile = (
  ctx: ExtractContext,
  sourceFile: SourceFile,
  options: {
    file: string;
    path: string;
    adapter: string;
    emit: (verb: FsRouteVerb) => void;
  },
): void => {
  const exported = sourceFile.getExportedDeclarations();
  let found = 0;
  for (const method of HTTP_METHODS) {
    const [declaration] = exported.get(method) ?? [];
    if (declaration === undefined) continue;
    found += 1;
    const at = reachOf(declaration, sourceFile, method, ctx.repoDir);
    const reading = verbReading(declaration);
    const read = reading?.bodyRead === true;
    options.emit({
      method,
      path: options.path,
      at,
      ...(reading === undefined ? {} : { handler: reading.fn }),
      bodyRead: read,
    });
    // The entry is still emitted, and the handler with it where there was one:
    // the route exists, the wrapper call is where the framework enters, and
    // dropping either would lose a fact that was read. What was missing was
    // this row (R94).
    if (!read) {
      reportUnreadHandler(ctx, {
        file: at.reached.file,
        line: at.reached.line,
        label: `${method} ${options.path}`,
        path: options.path,
        why: reading === undefined ? 'none' : 'built',
        adapter: options.adapter,
      });
    }
  }

  if (found > 0) return;
  ctx.builder.addUnresolved({
    file: options.file,
    line: 1,
    reason: 'route-verb-unread',
    message: `${options.file} is served at ${options.path} but exports no verb this could read.`,
    hint: 'Export GET, POST and the rest by name; a verb assembled at run time cannot be joined to anything that asks for it.',
    symbol: options.path,
    adapter: options.adapter,
  });
};
