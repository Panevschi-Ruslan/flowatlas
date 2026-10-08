import {
  applicationsServing,
  ROOT_APPLICATION,
  HTTP_METHODS,
  namedFunction,
  normalizePath,
  originOfValue,
  PARAM_PLACEHOLDER,
  reachOf,
  type ApplicationMap,
  type ExtractContext,
  type NamedFunction,
  type Reach,
} from '@flowatlas/core';
import type { Node as TsNode, SourceFile } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import { builtByFactory, builtExportFunction, handsOverWork, repoFunctionOf, unwrapValue } from './shared.js';

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
  /**
   * How a route's segments are laid out on disk, where not one per directory.
   *
   * `flat` is Remix's: a route is a file directly under the root, or a directory
   * directly under it holding one of `routeFiles`, and its segments are the
   * dots of that one name - `api.orders.$id.ts` is `/api/orders/:id`, and a dot
   * inside brackets (`[sitemap.xml]`) is a literal one (P38).
   */
  readonly layout?: 'flat';
}

/**
 * One way a directory name can mean something other than itself.
 *
 * A closed set on purpose. These are the spellings the file-system routers this
 * tool reads have between them, and a framework with a fifth adds a name here
 * and a rule to the table below, which is one place rather than two files.
 */
export type SegmentConvention =
  | 'group'
  | 'slot'
  | 'private'
  | 'param'
  | 'catch-all'
  | 'pathless'
  | 'dollar';

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

/**
 * `[id]` is one segment of any value; `[...rest]` and `[[...rest]]` are any
 * number; `[[lang]]` is one that may be absent, and `[id=integer]` names a
 * matcher after the param, which is no part of its name (SvelteKit).
 */
const DYNAMIC = /^\[(\.\.\.)?(.+?)\]$/;
const OPTIONAL = /^\[\[.+\]\]$/;

/** `$id` is a param, `$` alone the rest of the path, `($lang)` an optional one (Remix). */
const DOLLAR = /^(\()?\$([\w-]*)\)?$/;

/**
 * One segment as a router reads it: what it contributes to the address (the
 * key, every param renamed) and to the path as written (each param named, so a
 * handler's params can be named by the route the way a registered path names
 * them - P34).
 */
interface SegmentReading {
  readonly read: string;
  readonly raw: string;
}

/** A bracketed segment's name, without the brackets, the dots or a matcher. */
const dynamicName = (segment: string): string | undefined =>
  DYNAMIC.exec(segment.replace(/^\[(\[.*\])\]$/, '$1'))?.[2]?.replace(/=.*$/, '');

const named = (read: string, name: string | undefined, optional: boolean): SegmentReading => ({
  read,
  raw: name === undefined || name === '' ? read : `:${name}${optional ? '?' : ''}`,
});

/**
 * What one segment contributes to an address, by the convention that claims it.
 *
 * A lookup rather than a chain of branches, so that a router's `segments` list
 * is the whole of what decides which spellings apply to it. Each rule answers
 * `undefined` when the segment is not its business, `null` when the segment
 * contributes nothing, and a reading when it contributes that.
 *
 * `null` is a different answer from an empty string: a repository that spells a
 * group as a path serves `app/api/(admin)/users/route.ts` at `/api/users`, and
 * getting that wrong moves every route under it.
 */
const SEGMENT_RULES: Readonly<
  Record<SegmentConvention, (segment: string) => SegmentReading | null | undefined>
> = Object.freeze({
  group: (segment) => (GROUP.test(segment) ? null : undefined),
  slot: (segment) => (SLOT.test(segment) ? null : undefined),
  // Not a segment that drops out but a segment that cancels the route; the walk
  // below asks about this one separately and this rule exists so that a router
  // which does not honour underscores is not read as if it did.
  private: (segment) => (PRIVATE.test(segment) ? null : undefined),
  'catch-all': (segment) => {
    const dynamic = DYNAMIC.exec(segment.replace(/^\[(\[.*\])\]$/, '$1'));
    if (dynamic?.[1] === undefined) return undefined;
    return named('*', dynamicName(segment), OPTIONAL.test(segment));
  },
  param: (segment) => {
    const dynamic = DYNAMIC.exec(segment.replace(/^\[(\[.*\])\]$/, '$1'));
    if (dynamic === null || dynamic[1] !== undefined) return undefined;
    return named(PARAM_PLACEHOLDER, dynamicName(segment), OPTIONAL.test(segment));
  },
  // Remix: a leading underscore is a layout that adds no segment (`_index`
  // among them), and a trailing one only opts out of a parent's layout.
  pathless: (segment) => {
    if (PRIVATE.test(segment)) return null;
    if (!segment.endsWith('_')) return undefined;
    const literal = segment.slice(0, -1);
    return { read: literal, raw: literal };
  },
  dollar: (segment) => {
    const dollar = DOLLAR.exec(segment);
    if (dollar === null) return undefined;
    const name = dollar[2] ?? '';
    return name === '' ? { read: '*', raw: '*' } : named(PARAM_PLACEHOLDER, name, dollar[1] !== undefined);
  },
});

/** The conventions, in the order a segment is offered to them. */
const CONVENTION_ORDER: readonly SegmentConvention[] = [
  'group',
  'slot',
  'private',
  'pathless',
  'catch-all',
  'param',
  'dollar',
];

/** One segment of a directory path, as this router reads it. */
const segmentOf = (segment: string, router: FsRouter): SegmentReading | null => {
  if (segment === '') return null;
  for (const convention of CONVENTION_ORDER) {
    if (!router.segments.includes(convention)) continue;
    const read = SEGMENT_RULES[convention](segment);
    if (read !== undefined) return read;
  }
  return { read: segment, raw: segment };
};

/**
 * The segments of one flat name: split at each dot outside brackets, and the
 * brackets of an escaped part dropped (`[sitemap.xml]` is one literal segment).
 */
const dottedSegments = (name: string): string[] =>
  (name.match(/(?:\[[^\]]*\]|[^.])+/g) ?? []).map((part) =>
    /^\[[^\]]*\]$/.test(part) ? part.slice(1, -1) : part,
  );

/**
 * The segments of a route laid out flat, or nothing when the file is not one:
 * a route module directly under the root, or a folder's route file there.
 */
const flatSegments = (after: readonly string[], name: string, router: FsRouter): string[] | undefined => {
  if (after.length === 0) return dottedSegments(name);
  const [folder] = after;
  if (after.length === 1 && folder !== undefined && router.routeFiles?.includes(name) === true) {
    return dottedSegments(folder);
  }
  return undefined;
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
 * Which application a file belongs to, read from the segments in front of the
 * router root.
 *
 * A repository may hold more than one application, and the ones that do are not
 * exotic: payload keeps thirty-nine of them under `test/`, `templates/` and
 * `examples/`, each a whole application with its own `app/` directory. Every one
 * of those declares `api/[...slug]/route.ts`, so reading the router root wherever
 * it occurs and calling the result one address space made two hundred and
 * seventy-one route declarations claim the seventeen addresses their names
 * collide on, and the graph kept whichever arrived last. Seventeen of two
 * hundred and eighty-eight, and the arithmetic said nothing was missing.
 *
 * **One rule, and it is the same rule everywhere in this tool: an address is an
 * address within one application, and which application belongs in the identity
 * — `entry:<service>@<application>:<kind>:<key>` — not in the path** (R119,
 * R125). So the segments in front of the router root name the application, and
 * the address stays the one the framework serves.
 *
 * Keeping them in front of the path bought the same uniqueness and paid a price
 * that could not be seen in any total: the address became one no framework
 * answers on. Nothing serves `/test/fields/api/*`, and a caller written against
 * `/api/orders` could not join to an entry recorded at
 * `/examples/blog/api/orders` — with no row anywhere saying why, which is worse
 * than either address being wrong, because every join in this tool is keyed on
 * the address.
 *
 * `src` drops out: a framework may allow an application to sit either at a
 * package's root or under `src` and serves both at the same addresses, so
 * `examples/blog` and `examples/blog/src` are one application and not two. Where
 * the router's root already names `src` there is nothing in front of it to drop.
 */
const applicationOf = (before: readonly string[]): string => {
  const kept = [...before];
  if (kept[kept.length - 1] === SOURCE_DIRECTORY) kept.pop();
  return kept.length === 0 ? ROOT_APPLICATION : kept.join('/');
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
/**
 * What one file is, to one file-system router.
 *
 * Three answers and not two, because `null` was doing the work of two different
 * facts: a file the router has nothing to do with, and a file it has decided not
 * to serve. Only the second is worth a word to anybody, and telling them apart
 * here rather than at each caller is what keeps one decomposition of a path
 * (R91, R111).
 */
type FsFileReading =
  | { readonly kind: 'route'; readonly path: string; readonly rawPath: string; readonly application: string }
  | { readonly kind: 'not-served'; readonly why: 'private' }
  | { readonly kind: 'elsewhere' };

const ELSEWHERE: FsFileReading = { kind: 'elsewhere' };

/**
 * The segments of a route laid out one per directory, `private` when the
 * convention takes it out of service, or nothing when it is not a route file.
 */
const directorySegments = (
  after: string[],
  name: string,
  router: FsRouter,
): string[] | 'private' | undefined => {
  if (router.routeFiles !== undefined) {
    if (!router.routeFiles.includes(name)) return undefined;
  } else {
    // The older router: the file name is the last segment, and a private file
    // is not a route at all.
    if (optsOut(name, router)) return 'private';
    if (name !== 'index') after.push(name);
  }

  // A directory the underscore opts out of routing serves nothing at all, so a
  // file under one is not a route with a segment missing — it is not a route.
  if (after.some((segment) => optsOut(segment, router))) return 'private';
  return after;
};

const readFsFile = (file: string, router: FsRouter): FsFileReading => {
  if (file.startsWith('../')) return ELSEWHERE;
  const parts = file.split('/');
  const rootParts = router.root.split('/');
  let at = -1;
  for (let index = 0; index + rootParts.length <= parts.length && at < 0; index += 1) {
    if (rootParts.every((part, offset) => parts[index + offset] === part)) at = index;
  }
  if (at < 0) return ELSEWHERE;

  const application = applicationOf(parts.slice(0, at));
  const after = parts.slice(at + rootParts.length);
  const name = (after.pop() ?? '').replace(FILE_EXTENSION, '');
  if (name === '') return ELSEWHERE;

  const segments = router.layout === 'flat' ? flatSegments(after, name, router) : directorySegments(after, name, router);
  if (segments === undefined) return ELSEWHERE;
  if (segments === 'private') return { kind: 'not-served', why: 'private' };

  // A grouped or slot directory drops out; nothing else may, because a segment
  // that could not be read would make the address a different one.
  const kept = segments.flatMap((segment) => {
    const read = segmentOf(segment, router);
    return read === null ? [] : [read];
  });
  const prefix = router.prefix ?? '';
  return {
    kind: 'route',
    path: normalizePath(`${prefix}/${kept.map((segment) => segment.read).join('/')}`),
    // Joined as written: normalising would rename every param `:param` again.
    rawPath: `/${[...prefix.split('/'), ...kept.map((segment) => segment.raw)].filter((segment) => segment !== '').join('/')}`,
    application,
  };
};

/**
 * The address one file is served at, or nothing when it is not served there.
 *
 * The address the framework serves it at, and nothing else: which application
 * serves it is a separate fact and is asked of {@link fsAddressSpace} by whatever
 * mints an identity. A reader that only wants to say where a screen lives —
 * which is what the front-end index wants of a page file — wants this one.
 */
export const routePathOfFile = (file: string, router: FsRouter): string | null => {
  const reading = readFsFile(file, router);
  return reading.kind === 'route' ? reading.path : null;
};

/** One address a file-system router serves, and which application serves it. */
export interface FsAddress {
  /** What the framework answers on, with nothing in front of it. */
  readonly path: string;
  /**
   * The path with its params named, where it names any - the key has every
   * param renamed - so a handler's params are named by the route (P34).
   */
  readonly rawPath?: string;
  /**
   * The qualifier the entry id carries, absent where the service holds one
   * application and the address is therefore the identity by itself.
   */
  readonly application?: string;
}

/** Every address one service's file-system routers serve. */
export interface FsAddressSpace {
  readonly addressOf: (file: string, router: FsRouter) => FsAddress | null;
}

/**
 * Which applications one service's file-system routers hold, read once for the
 * whole of it.
 *
 * Once for the service rather than per file, because no single file can answer
 * the question: whether an id needs to name an application depends on how many
 * applications the service has, and that is a fact about every file in it.
 *
 * The judgement itself is not made here, and not here either. `applicationsServing` is the one place
 * that decides whether an id carries an application — deliberately one place, so
 * that two adapters cannot disagree about it (R119) — and every caller below
 * hands it this map. Every application mounts itself, because what the map is
 * asked about is the application: a file-system router has no declaration to
 * key on, only a directory, and the directory *is* the application. That is
 * also why the same map can say which application a call site is in, which a
 * map of declarations cannot (R132).
 */
export const fsApplicationMap = (
  files: Iterable<string>,
  routers: readonly FsRouter[],
): ApplicationMap => {
  const names = new Set<string>();
  for (const file of files) {
    for (const router of routers) {
      const reading = readFsFile(file, router);
      if (reading.kind === 'route') names.add(reading.application);
    }
  }
  return {
    names: [...names].sort(),
    of: Object.fromEntries([...names].map((name) => [name, [name]])),
    // Directories, and said so: the same map has to answer which application a
    // file that declares no route at all is in — a component making a request
    // — and only a map whose keys are directories can (R132).
    keyedBy: 'directory',
  };
};

/**
 * The address space of one service, read once for the whole of it.
 *
 * The map is read separately and handed in, because the same map answers a
 * second question this has no part in: which application a call site belongs to.
 * One reading of the directories, two callers, and no way for them to disagree.
 */
export const fsAddressSpace = (map: ApplicationMap): FsAddressSpace => {
  return {
    addressOf: (file, router) => {
      const reading = readFsFile(file, router);
      if (reading.kind !== 'route') return null;
      const [application] = applicationsServing(map, reading.application);
      return {
        path: reading.path,
        ...(reading.rawPath === reading.path ? {} : { rawPath: reading.rawPath }),
        ...(application === undefined ? {} : { application }),
      };
    },
  };
};

/**
 * Why a file this router would otherwise serve is not served, or nothing when
 * the file was never its business.
 *
 * A file called `route.ts` that exports a verb and answers at no address is
 * exactly the shape this project refuses to pass over in silence: correct
 * behaviour that reads identically to a reader that gave up (R84). The caller
 * turns it into one informational row.
 */
export const unservedRouteFile = (file: string, router: FsRouter): 'private' | null => {
  const reading = readFsFile(file, router);
  return reading.kind === 'not-served' ? reading.why : null;
};

/** The row for a route file the framework's own convention takes out of service. */
export const reportNotServed = (
  ctx: ExtractContext,
  options: { file: string; why: 'private'; adapter: string },
): void => {
  ctx.builder.addUnresolved({
    file: options.file,
    line: 1,
    reason: 'route-file-not-served',
    level: 'info',
    message: `${options.file} exports a verb and is served at no address, because a segment of its path begins with an underscore and this router does not serve those.`,
    hint: 'Nothing to do if that is deliberate; move the file out from under the underscored directory if it was meant to answer requests.',
    symbol: options.file,
    adapter: options.adapter,
  });
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
  /**
   * `function` when the function is the verb's own - declared under that name,
   * or the call it was built by, with the work handed to it; `call` when it is a
   * factory of this repository that the verb's call ran, whose body holds the
   * handler it returned (R153). The same two words a registration's `handlerVia`
   * uses, and for the same two facts.
   */
  via: 'function' | 'call';
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
 * What counts as work is `handsOverWork`'s answer, the one a registration's
 * reader gets too. A call handed none is not yet the end of it: the function
 * called may itself be this repository's, and that is `builtByFactory`'s
 * question, asked first in `verbReading` (R153).
 */
const callHandedWork = (body: TsNode): boolean =>
  !Node.isCallExpression(body) || body.getArguments().some(handsOverWork);

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
 *
 * A value a call built is read one of three ways, and which is decided by the
 * call. Handed work, the call is a wrapper round a handler written or named in
 * it, and the node the index gave the export is the answer. Handed only values,
 * by a function this repository declares - a CMS monorepo's `REST_GET(config)` - the
 * handler is what that factory returns and its body is the factory's, so the
 * factory is the answer: the reading a registration gets from the same shared
 * `builtByFactory` (R137, R153). Handed only values by a package, nothing
 * behind the way in is in this repository, and that is the row.
 */
export const verbReading = (declaration: TsNode, depth = 0): VerbReading | undefined => {
  const written = exportedFunction(declaration);
  // A function declared here: its body is the body, and there is nothing to
  // doubt about whether it was read.
  if (written !== undefined) return { fn: written, bodyRead: true, via: 'function' };
  const built = builtExportFunction(declaration);
  if (built === undefined) return aliasedFunction(declaration, depth);
  const factory = builtByFactory(built.body);
  if (factory !== undefined) return { fn: factory, bodyRead: true, via: 'call' };
  // A value a call handed back: what the node points at is the call, so whether
  // anything was read depends on what the call was handed.
  return { fn: built, bodyRead: callHandedWork(built.body), via: 'function' };
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
    `${where} is the value a call handed back, and neither the function called nor anything handed to it is declared in this repository, so the way in has no handler that could be read.`,
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

/** The exports a route file answers by, where each is named after its verb. */
const VERB_EXPORTS: ReadonlyMap<string, string> = new Map(HTTP_METHODS.map((method) => [method, method]));

const NO_EXPORTS: ReadonlyMap<string, string> = new Map();

const KNOWN_METHODS: ReadonlySet<string> = new Set(HTTP_METHODS);

/** `request.method`, `method` taken out of it, or either upper- or lower-cased. */
const isMethodRead = (node: TsNode): boolean => {
  const value = unwrapValue(node);
  if (Node.isCallExpression(value)) {
    const callee = value.getExpression();
    return Node.isPropertyAccessExpression(callee) && /^to(Upper|Lower)Case$/.test(callee.getName())
      ? isMethodRead(callee.getExpression())
      : false;
  }
  if (Node.isPropertyAccessExpression(value)) return value.getName() === 'method';
  return Node.isIdentifier(value) && value.getText() === 'method';
};

/** A string literal's verb, when it is one. */
const verbOf = (node: TsNode | undefined): string | undefined => {
  if (node === undefined || !Node.isStringLiteral(node) && !Node.isNoSubstitutionTemplateLiteral(node)) return undefined;
  const verb = node.getLiteralText().toUpperCase();
  return KNOWN_METHODS.has(verb) ? verb : undefined;
};

const EQUALITY: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.EqualsEqualsEqualsToken,
  SyntaxKind.EqualsEqualsToken,
  SyntaxKind.ExclamationEqualsEqualsToken,
  SyntaxKind.ExclamationEqualsToken,
]);

/** The verbs one comparison or one `case` names, by how it is written. */
const COMPARED: ReadonlyMap<SyntaxKind, (node: TsNode) => string | undefined> = new Map([
  [
    SyntaxKind.BinaryExpression,
    (node: TsNode) => {
      if (!Node.isBinaryExpression(node) || !EQUALITY.has(node.getOperatorToken().getKind())) return undefined;
      const [left, right] = [node.getLeft(), node.getRight()];
      if (isMethodRead(left)) return verbOf(right);
      return isMethodRead(right) ? verbOf(left) : undefined;
    },
  ],
  [
    SyntaxKind.CaseClause,
    (node: TsNode) => {
      const owner = node.getParent()?.getParent();
      return Node.isCaseClause(node) && owner !== undefined && Node.isSwitchStatement(owner) && isMethodRead(owner.getExpression())
        ? verbOf(node.getExpression())
        : undefined;
    },
  ],
]);

/**
 * The verbs a handler compares its request's method to, in the order written.
 *
 * Remix sends every verb but GET to a route's `action`, and an action that
 * answers more than one says which by comparing `request.method` to them. Only
 * literals count: a method compared to a name is a verb this cannot know.
 */
export const methodsCompared = (body: TsNode): string[] => {
  const found = new Set<string>();
  body.forEachDescendant((node) => {
    const verb = COMPARED.get(node.getKind())?.(node);
    if (verb !== undefined) found.add(verb);
  });
  return [...found];
};

/** The action a form posts to when it names none. */
const DEFAULT_ACTION = 'default';

/** One member of an object of ways in, and what stands behind it. */
interface ActionMember {
  readonly name: string;
  readonly node: TsNode;
  readonly handler?: NamedFunction;
  readonly inline?: TsNode;
}

/** `{ … } satisfies Actions` and `({ … }) as Actions` are the object inside. */
const objectOf = (value: TsNode): TsNode =>
  Node.isSatisfiesExpression(value) ? objectOf(value.getExpression()) : unwrapValue(value);

/**
 * What one member of an exported object of ways in stands for, by how it was
 * written: an arrow or function written there is its own handler; a name is
 * the function it names. A method has no node a way in can point at, and says
 * so through the unread row.
 */
const MEMBER_READINGS: ReadonlyMap<SyntaxKind, (property: TsNode) => Omit<ActionMember, 'name' | 'node'>> = new Map([
  [
    SyntaxKind.PropertyAssignment,
    (property: TsNode) => {
      const written = Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
      const value = written === undefined ? undefined : unwrapValue(written);
      if (value === undefined) return {};
      if (Node.isArrowFunction(value) || Node.isFunctionExpression(value)) return { inline: value };
      const fn = repoFunctionOf(value);
      return fn === undefined ? {} : { handler: fn };
    },
  ],
  [
    SyntaxKind.ShorthandPropertyAssignment,
    (property: TsNode) => {
      // The name node's symbol is the property's; the value's is the function.
      // An imported one is the import's until its alias is followed.
      const symbol = Node.isShorthandPropertyAssignment(property) ? property.getValueSymbol() : undefined;
      const declaration = (symbol?.isAlias() === true ? symbol.getAliasedSymbol() : symbol)?.getDeclarations()[0];
      const fn = declaration === undefined ? undefined : namedFunction(declaration);
      return fn === undefined ? {} : { handler: fn };
    },
  ],
]);

/**
 * The members of an exported object whose every member is a way in.
 *
 * SvelteKit's `export const actions = { default: …, login: … }`: each key is an
 * action a form posts to, and the page's address with `?/key` after it is the
 * address of every one but the default (P42).
 */
const actionMembers = (declaration: TsNode): ActionMember[] => {
  if (!Node.isVariableDeclaration(declaration)) return [];
  const initializer = declaration.getInitializer();
  const literal = initializer === undefined ? undefined : objectOf(initializer);
  if (literal === undefined || !Node.isObjectLiteralExpression(literal)) return [];
  return literal.getProperties().flatMap((property): ActionMember[] => {
    if (Node.isSpreadAssignment(property)) return [];
    const name = property.getName();
    const reading = MEMBER_READINGS.get(property.getKind());
    return [{ name, node: property, ...(reading === undefined ? {} : reading(property)) }];
  });
};

/** One way in a file-system router declares, as the reader of one describes it. */
export interface FsRouteVerb {
  method: string;
  path: string;
  /** The path with its params named, where it names any (P34). */
  rawPath?: string;
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
  /** A function written in place as the way in, found again by where it starts (P42). */
  inline?: TsNode;
  /**
   * The named form action this way in is, where it is one: SvelteKit posts
   * `?/login` to the page that declares `actions.login` (P42). The default
   * action is the page's own POST and has none.
   */
  action?: string;
  /**
   * How the handler was named, as the entry's `handlerVia` says it: `unread`
   * where there is none, `call` where it is a factory the verb's call ran (R153).
   * Decided here rather than by each reader, which is how two readers of one
   * route file would come to say two things about it.
   */
  handlerVia: VerbReading['via'] | 'inline' | 'unread';
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
    rawPath?: string | undefined;
    adapter: string;
    emit: (verb: FsRouteVerb) => void;
    /**
     * Which exports are ways in, and the verb each answers: the verbs' own
     * names unless the framework names them otherwise - Remix's `loader` is a
     * GET and its `action` a POST (P38).
     */
    verbs?: ReadonlyMap<string, string>;
    /**
     * Whether a file exporting none of them is a page rather than a route with
     * its verb missing, and so says nothing: every Remix route module is served,
     * and most of them only render.
     */
    pagesServed?: boolean;
    /**
     * Exports that are objects of ways in, and the verb each member answers:
     * SvelteKit's `actions`, every one of them a POST (P42).
     */
    actions?: ReadonlyMap<string, string>;
    /**
     * Exports whose verbs are the ones the handler compares `request.method`
     * to, where it compares it to any: a Remix `action` that branches on
     * `'DELETE'` and `'PUT'` answers those, not a POST (P43).
     */
    narrowed?: ReadonlySet<string>;
  },
): void => {
  const exported = sourceFile.getExportedDeclarations();
  let found = 0;
  for (const [name, method] of options.actions ?? NO_EXPORTS) {
    const [declaration] = exported.get(name) ?? [];
    if (declaration === undefined) continue;
    found += 1;
    for (const member of actionMembers(declaration)) {
      const at = reachOf(member.node, sourceFile, `${name}.${member.name}`, ctx.repoDir);
      const handled = member.handler !== undefined || member.inline !== undefined;
      options.emit({
        method,
        path: options.path,
        ...(options.rawPath === undefined ? {} : { rawPath: options.rawPath }),
        ...(member.name === DEFAULT_ACTION ? {} : { action: member.name }),
        at,
        ...(member.handler === undefined ? {} : { handler: member.handler }),
        ...(member.inline === undefined ? {} : { inline: member.inline }),
        handlerVia: member.inline !== undefined ? 'inline' : handled ? 'function' : 'unread',
        bodyRead: handled,
      });
      if (!handled) {
        reportUnreadHandler(ctx, {
          file: at.reached.file,
          line: at.reached.line,
          label: `${method} ${options.path}${member.name === DEFAULT_ACTION ? '' : `?/${member.name}`}`,
          path: options.path,
          why: 'none',
          adapter: options.adapter,
        });
      }
    }
  }
  for (const [name, method] of options.verbs ?? VERB_EXPORTS) {
    const [declaration] = exported.get(name) ?? [];
    if (declaration === undefined) continue;
    found += 1;
    const at = reachOf(declaration, sourceFile, name, ctx.repoDir);
    const reading = verbReading(declaration);
    const read = reading?.bodyRead === true;
    const compared =
      options.narrowed?.has(name) === true && reading?.via === 'function' ? methodsCompared(reading.fn.body) : [];
    for (const answered of compared.length > 0 ? compared : [method]) {
      options.emit({
        method: answered,
        path: options.path,
        ...(options.rawPath === undefined ? {} : { rawPath: options.rawPath }),
        at,
        ...(reading === undefined ? {} : { handler: reading.fn }),
        handlerVia: reading?.via ?? 'unread',
        bodyRead: read,
      });
    }
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

  if (found > 0 || options.pagesServed === true) return;
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
