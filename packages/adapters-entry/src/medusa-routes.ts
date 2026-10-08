import {
  hasAnyDependency,
  HTTP_METHODS,
  makeEntryId,
  reachMeta,
  makeHttpEntryKey,
  normalizeFilePath,
  type ApplicationMap,
  type EntryAdapter,
  type EntryNode,
  type EntryWrapping,
  type ExtractContext,
} from '@flowatlas/core';
import type { Node as TsNode } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import {
  fsAddressSpace,
  fsApplicationMap,
  pathPatternTest,
  readVerbFile,
  reportNotServed,
  unservedRouteFile,
  type FsRouter,
  type FsRouteVerb,
} from './fs-routes.js';
import { MEDUSA_REQUEST, readingOf } from './request-readings.js';
import { arrayElements, fileOfNode, handlerOfFunction, repoSources, unwrapValue } from './shared.js';

const ADAPTER = 'medusa-routes';

/**
 * The packages that give the framework away.
 *
 * Two of them, because the application and the framework are separate packages
 * and a repository declares whichever it is: a project built on it depends on
 * `@medusajs/medusa`, and the framework package itself is what the application
 * in this monorepo declares. Either one means the file-system router below.
 */
const PACKAGES = ['@medusajs/medusa', '@medusajs/framework'];

/** How a route's handler is handed its request and answers it (P29). */
const REQUEST = readingOf(MEDUSA_REQUEST);

/**
 * The router, as a row of the description every file-system router here shares.
 *
 * Four values, and they are the whole of what makes this framework's address
 * space different from the other one's (R91). `src/api` is the root; `route.ts`
 * is the file that declares rather than names; nothing stands in front of what
 * it serves, so `/admin/orders` is the address of `src/api/admin/orders`; and of
 * the five segment spellings this tool knows it honours two. An underscore opts
 * a subtree out — the loader filters any path segment starting with one — and
 * `[id]` is a parameter. It has no groups, no slots and no catch-all: its
 * parameter matcher is `\[(\w+)\]`, so `[...rest]` is not a segment of any
 * number but a literal directory called `[...rest]`, and a directory it happens
 * to call `(admin)` is a literal segment of every address under it.
 */
export const MEDUSA_API: FsRouter = {
  root: 'src/api',
  routeFiles: ['route'],
  segments: ['private', 'param'],
};

/** Where the declarative middleware list lives, when a repository has one. */
const MIDDLEWARE_FILES = ['src/api/middlewares.ts', 'src/api/middlewares.js'];

/** The call whose argument is that list. */
const DEFINE_MIDDLEWARES = 'defineMiddlewares';

/** One entry of the declarative list, as much of it as could be read. */
interface MiddlewareEntry {
  /** Which addresses it covers, or `undefined` when the pattern was not read. */
  covers?: (path: string) => boolean;
  /** The pattern as written, which is what the framework orders the list by. */
  pattern: string;
  /** Which verbs, or `undefined` for every verb. */
  methods?: readonly string[];
  /** The functions it installs, in the order written, where each is written. */
  installs: readonly EntryWrapping[];
}

/** The whole list, and what of it could not be read. */
interface MiddlewareList {
  file: string;
  entries: readonly MiddlewareEntry[];
  /** Matchers written as something other than a path pattern. */
  unread: readonly string[];
}

/** What a value in the `middlewares` array is called, as far as it has a name. */
const nameOf = (node: TsNode): string => {
  const value = unwrapValue(node);
  if (Node.isCallExpression(value)) {
    const callee = value.getExpression();
    return Node.isPropertyAccessExpression(callee) ? callee.getName() : callee.getText();
  }
  if (Node.isIdentifier(value) || Node.isPropertyAccessExpression(value)) return value.getText();
  return value.getKindName();
};

/** The value a property of an object literal was given, if it has that property. */
const propertyOf = (literal: TsNode, key: string): TsNode | undefined => {
  if (!Node.isObjectLiteralExpression(literal)) return undefined;
  const property = literal.getProperty(key);
  if (property === undefined || !Node.isPropertyAssignment(property)) return undefined;
  const written = property.getInitializer();
  return written === undefined ? undefined : unwrapValue(written);
};

/** A string literal's value, or `undefined` when the node is not one. */
const literalString = (node: TsNode | undefined): string | undefined => {
  if (node === undefined) return undefined;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralValue();
  }
  return undefined;
};

/** The argument the list call was handed, whichever of its two shapes it is. */
const listArgument = (call: TsNode): TsNode | undefined => {
  if (!Node.isCallExpression(call)) return undefined;
  const [written] = call.getArguments();
  if (written === undefined) return undefined;
  const value = unwrapValue(written);
  if (Node.isArrayLiteralExpression(value)) return value;
  // The other spelling the helper accepts: `{ routes: [...], errorHandler }`.
  const routes = propertyOf(value, 'routes');
  return routes !== undefined && Node.isArrayLiteralExpression(routes) ? routes : undefined;
};

/**
 * The declarative middleware list, when the repository has one.
 *
 * A framework whose routes have no call site puts what stands in front of them
 * in a list rather than in an argument, which is the one part of this convention
 * that is an expression to read rather than a path to parse. Two keys of each
 * entry are what a route needs: which addresses it covers and which verbs, and
 * `matcher` is an ordinary path pattern most of the time and a regular
 * expression the rest of it — the same split the other file-system router's
 * guard file has, read by the same test, because "does this pattern cover this
 * address" is one question (R91).
 */
const readMiddlewareList = (ctx: ExtractContext): MiddlewareList | undefined => {
  for (const sourceFile of repoSources(ctx)) {
    const file = normalizeFilePath(sourceFile.getFilePath(), ctx.repoDir);
    if (!MIDDLEWARE_FILES.includes(file)) continue;

    // Found by the call rather than by the export, because the helper's result
    // is exported in three ways across real repositories — `export default
    // defineMiddlewares([…])`, a const exported afterwards, and a const the file
    // only uses — and all three are the same list.
    const written = sourceFile
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .find((node) => node.getExpression().getText().endsWith(DEFINE_MIDDLEWARES));
    const list = written === undefined ? undefined : listArgument(written);
    if (list === undefined || !Node.isArrayLiteralExpression(list)) {
      return { file, entries: [], unread: [] };
    }

    const entries: MiddlewareEntry[] = [];
    const unread: string[] = [];
    for (const element of arrayElements(list.getElements())) {
      const matcher = propertyOf(element, 'matcher');
      const installed = propertyOf(element, 'middlewares');
      // An entry that installs nothing this could name says nothing about what
      // stands in front of a route. It is left out rather than recorded empty:
      // a route with an entry that names no function is a route with nothing
      // named in front of it, and the two must read the same.
      const installs: EntryWrapping[] =
        installed !== undefined && Node.isArrayLiteralExpression(installed)
          ? arrayElements(installed.getElements()).map((value) => ({
              label: nameOf(value),
              layer: 'middleware',
              // A path pattern, and what it covers is every address under it.
              scope: 'prefix',
              source: DEFINE_MIDDLEWARES,
              file: fileOfNode(value, ctx),
              line: value.getStartLineNumber(),
              kind: 'function',
            }))
          : [];
      if (installs.length === 0) continue;

      const pattern = literalString(matcher);
      const covers = pattern === undefined ? undefined : pathPatternTest(pattern);
      if (pattern === undefined || covers === undefined) {
        unread.push(pattern ?? (matcher?.getText() ?? 'an unread matcher'));
        continue;
      }
      const methods = readMethods(element);
      entries.push({
        covers,
        pattern,
        ...(methods === undefined ? {} : { methods }),
        installs,
      });
    }
    return { file, entries: inFrameworkOrder(entries), unread };
  }
  return undefined;
};

/** The framework's buckets for one segment, in the order it runs them. */
const BUCKETS = ['global', 'wildcard', 'regex', 'static', 'params'] as const;

type Bucket = (typeof BUCKETS)[number];

type Branch = Record<Bucket, { entries: MiddlewareEntry[]; children: Map<string, Branch> }>;

const newBranch = (): Branch => ({
  global: { entries: [], children: new Map() },
  wildcard: { entries: [], children: new Map() },
  regex: { entries: [], children: new Map() },
  static: { entries: [], children: new Map() },
  params: { entries: [], children: new Map() },
});

/** Which bucket one segment of a pattern falls in, as the framework decides it. */
const bucketOf = (segment: string, entry: MiddlewareEntry): Bucket => {
  if (entry.methods === undefined) return 'global';
  if (segment.startsWith('*')) return 'wildcard';
  if (segment.startsWith(':')) return 'params';
  if (/[(+*[\]!)]/.test(segment)) return 'regex';
  return 'static';
};

/**
 * The list in the order the framework runs it, which is not the order written.
 *
 * The framework does not install the list as it is written: it files every
 * pattern into a tree by segment and walks the tree, putting an entry that names
 * no verb before one that does, a wildcard before a literal and a literal before
 * a parameter, and a pattern before the patterns below it. The position in the
 * chain is the one thing a `guarded_by` edge is asked (R109), so that order is
 * what this records rather than the order the list is written in. Only patterns
 * this reads as a path reach it, which is why a pattern given as a regular
 * expression is never ordered here.
 */
const inFrameworkOrder = (entries: readonly MiddlewareEntry[]): MiddlewareEntry[] => {
  const root = newBranch();
  for (const entry of entries) {
    const segments = entry.pattern.split('/').filter((segment) => segment.length > 0);
    if (segments.length === 0) {
      root[entry.methods === undefined ? 'global' : 'static'].entries.push(entry);
      continue;
    }
    let branch = root;
    segments.forEach((segment, index) => {
      const bucket = branch[bucketOf(segment, entry)];
      if (index === segments.length - 1) {
        bucket.entries.push(entry);
        return;
      }
      const child = bucket.children.get(segment) ?? newBranch();
      bucket.children.set(segment, child);
      branch = child;
    });
  }
  const walk = (branches: Iterable<Branch>): MiddlewareEntry[] => {
    const out = new Map<Bucket, MiddlewareEntry[]>(BUCKETS.map((bucket) => [bucket, []]));
    for (const branch of branches) {
      for (const bucket of BUCKETS) {
        out.get(bucket)?.push(...branch[bucket].entries, ...walk(branch[bucket].children.values()));
      }
    }
    return BUCKETS.flatMap((bucket) => out.get(bucket) ?? []);
  };
  return walk([root]);
};

/** The verbs one entry names, or `undefined` when it names none and covers all. */
const readMethods = (element: TsNode): readonly string[] | undefined => {
  // Two keys for one fact: the plural is the current spelling and the singular
  // is the one the helper still accepts, which is why both are asked for rather
  // than one being taken as the truth.
  for (const key of ['methods', 'method']) {
    const written = propertyOf(element, key);
    if (written === undefined) continue;
    const values = Node.isArrayLiteralExpression(written)
      ? written.getElements().map((value) => literalString(unwrapValue(value)))
      : [literalString(written)];
    const named = values.filter((value): value is string => value !== undefined);
    if (named.length > 0) return named.map((value) => value.toUpperCase());
  }
  return undefined;
};

/**
 * Entry points a repository built on this framework declares by where its files
 * are.
 *
 * The reading is the shared one; what is written here is the description it is
 * driven by and the two facts particular to this framework — the middleware list
 * and what this reader does not know about what stands in front of a route.
 *
 * Measured before this existed: four hundred and eighty-seven exported verb
 * handlers in `packages/medusa`, of which one was read, and that one from a test
 * fixture that happens to register a route on an Express application (R91). The
 * repository declares `express`, so the call-registered reader was turned on,
 * recognised the framework's own dependency and came away with one route out of
 * four hundred and eighty-eight — a number that looked like a clean repository
 * rather than like a convention nobody had described.
 */
/** Which applications this repository holds; see the Next.js reader's own. */
const applicationsOf = (ctx: ExtractContext): ApplicationMap =>
  fsApplicationMap(
    [...repoSources(ctx)].map((source) => normalizeFilePath(source.getFilePath(), ctx.repoDir)),
    [MEDUSA_API],
  );

export const medusaRoutesAdapter: EntryAdapter = {
  name: ADAPTER,
  detect: (pkg) => hasAnyDependency(pkg, PACKAGES),
  applications: (ctx) => applicationsOf(ctx),

  extractEntries(ctx: ExtractContext): EntryNode[] {
    const entries: EntryNode[] = [];
    const seen = new Set<string>();
    const list = readMiddlewareList(ctx);

    /**
     * What of the list stands in front of one route, in the order it runs.
     *
     * Described, not listed on the entry: each becomes a node and a
     * `guarded_by` edge, which is how every other reader says it (R109).
     *
     * It is not the whole chain, which is why `middlewareRead` is deliberately
     * `false` on every route, and it is false for a reason that is not the
     * list. Three things stand in front of a route here: the entries of the
     * declarative list, which are read here; the
     * framework's own authentication of its `/admin` and `/store` namespaces,
     * which is installed by the framework's own code and not by anything in this
     * repository; and an `AUTHENTICATE` export in the route file that switches
     * the second off. This reader reads the first of the three, so it says it did
     * not read them all, and the audit lists such a route as something to check
     * by hand rather than as a route with a hole in front of it. Claiming a guard
     * nobody saw is the worst thing this tool could say, and so is denying one.
     */
    const gateOf = (method: string, path: string): readonly EntryWrapping[] =>
      (list?.entries ?? [])
        .filter(
          (entry) =>
            entry.covers?.(path) === true &&
            (entry.methods === undefined || entry.methods.includes(method)),
        )
        .flatMap((entry) => entry.installs);

    const httpEntry = (verb: FsRouteVerb, application: string | undefined): void => {
      const key = makeHttpEntryKey(verb.method, verb.path);
      const id = makeEntryId(ctx.repo, 'http', key, application);
      if (seen.has(id)) return;
      seen.add(id);
      const gate = gateOf(verb.method, verb.path);
      entries.push({
        id,
        kind: 'http',
        label:
          application === undefined
            ? `${verb.method} ${verb.path}`
            : `${verb.method} ${verb.path} (${application})`,
        key,
        ...(verb.handler === undefined ? {} : { handler: handlerOfFunction(verb.handler, ctx) }),
        request: REQUEST,
        // The route file is what the node points at, because the address is read
        // from where that file is; where the verb was written is recorded beside
        // it rather than folded into it (R99).
        file: verb.at.reached.file,
        line: verb.at.reached.line,
        ...(gate.length > 0 ? { wrapping: gate } : {}),
        meta: {
          method: verb.method,
          path: verb.path,
          // The params as the directories name them, which the key renamed (P34).
          ...(verb.rawPath === undefined ? {} : { rawPath: verb.rawPath }),
          adapter: ADAPTER,
          registration: 'api/route',
          // Only where the service holds more than one, which is where it says
          // something: it is what tells a tie between two applications from a
          // tie between two routes of one (R119, R125).
          ...(application === undefined ? {} : { application }),
          middlewareRead: false,
          handlerVia: verb.handlerVia,
          // Two different facts, and the second is the one a summary must not
          // read off the first. `handlerVia` says whether a function was named;
          // this says whether there is code behind the name (R94).
          ...(verb.bodyRead ? {} : { handlerBodyRead: false }),
          ...reachMeta(verb.at),
        },
      });
    };

    // Which applications this repository holds — a plugin under `plugins/` is a
    // whole one, with an address space of its own — and what each address is
    // qualified by. Read for the whole service before any of it is emitted,
    // because whether an id names an application depends on how many there
    // are, which is the one thing a single file cannot say (R125).
    const space = fsAddressSpace(applicationsOf(ctx));

    for (const sourceFile of repoSources(ctx)) {
      const file = normalizeFilePath(sourceFile.getFilePath(), ctx.repoDir);
      const address = space.addressOf(file, MEDUSA_API);
      if (address === null) {
        // A file the convention takes out of service, which is not the same as a
        // file this router never had anything to do with. Only the first is worth
        // a row, and only when it exports something that would have been a route.
        const why = unservedRouteFile(file, MEDUSA_API);
        if (why !== null && HTTP_METHODS.some((verb) => sourceFile.getExportedDeclarations().has(verb))) {
          reportNotServed(ctx, { file, why, adapter: ADAPTER });
        }
        continue;
      }
      readVerbFile(ctx, sourceFile, {
        file,
        path: address.path,
        rawPath: address.rawPath,
        adapter: ADAPTER,
        emit: (verb) => httpEntry(verb, address.application),
      });
    }

    if (list !== undefined && list.unread.length > 0) {
      const count = list.unread.length;
      ctx.builder.addUnresolved({
        file: list.file,
        line: 1,
        reason: 'middleware-matcher-unread',
        sites: count,
        message: `${count} matcher${count === 1 ? '' : 's'} in the middleware list ${count === 1 ? 'is' : 'are'} not a path pattern, so which routes ${count === 1 ? 'it covers' : 'they cover'} was not read.`,
        hint: 'Routes those entries cover are reported with nothing named in front of them. Write the matcher as a path pattern, or name the routes under doctor.publicRoutes.',
        symbol: list.unread.slice(0, 4).join(' '),
        adapter: ADAPTER,
      });
    }

    return entries;
  },
};
