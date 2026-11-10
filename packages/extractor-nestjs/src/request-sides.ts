/**
 * Which side of a full-stack application each request runs on (P283).
 *
 * A repository built on a file-system router - Remix, React Router, Next,
 * SvelteKit - is a browser and a server in one directory, and both halves of
 * the reading walk every file of it: the browser half records each request as
 * a browser's (`ui_api_call`), the server half the same call as one between
 * services (`http_out`). A storefront whose every request is made by a loader
 * on the server was drawn with each of them twice, once from a browser that
 * never makes it.
 *
 * So each request is drawn once, on the side it runs on, decided by what
 * reaches the function that makes it:
 *
 * - a file only one side runs says so on its own: `*.server.ts`, a `.server/`
 *   folder, SvelteKit's `+server.ts` and `lib/server/`, a module marked
 *   `'use server'` or importing `server-only`, for the server; `*.client.ts`,
 *   a `.client/` folder, `'use client'` or `client-only`, for the browser;
 * - a server's way in runs its handler on the server: a route's loader or
 *   action, a route handler, a consumer;
 * - a screen runs in the browser, and so does what a click on it runs; in a
 *   Next application a component under `app/` that is not marked
 *   `'use client'` is a server component, and one outside `app/` and
 *   `pages/` not marked either way may be rendered by either;
 * - the functions a framework runs on the server by their name, Next's
 *   `getServerSideProps` and kin, and in the browser, a route's
 *   `clientLoader` and `clientAction`; on both, SvelteKit's universal `load`
 *   in `+page.ts` or `+layout.ts` and Next's `getInitialProps`.
 *
 * A function the calls of the repository reach from one side only makes its
 * request on that side, and the other half's node goes, with the edges at
 * either end of it and the rows about it. Reached from both, or from nothing
 * read, both stay, each naming the other under `meta.sameCall`, so a reader
 * can count the call once.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GraphNode, RepoGraph } from '@flowatlas/core';

/** A side of the application a function runs on. */
type Side = 'server' | 'browser';

/** The key `meta` names the other half's node of one call under. */
export const SAME_CALL_META = 'sameCall';

const REQUEST_TYPES = { browser: 'ui_api_call', server: 'http_out' } as const;

/** Functions a framework calls on the server by their name. */
const SERVER_NAMES = new Set(['getServerSideProps', 'getStaticProps', 'getStaticPaths', 'generateStaticParams', 'generateMetadata', 'generateViewport']);

/** Functions a framework calls in the browser by their name. */
const BROWSER_NAMES = new Set(['clientLoader', 'clientAction']);

/** A SvelteKit module whose `load` runs on both sides. */
const UNIVERSAL_LOAD = /(?:^|\/)\+(?:page|layout)(?:@[^/.]*)?\.[cm]?[jt]s$/;

/** What a route module of Remix or React Router's framework runs on the server, the root's among them. */
const ROUTE_MODULE_SERVER_NAMES = new Set(['loader', 'action', 'headers']);

/** A directive or an import at the top of a module that says which side runs it. */
const DIRECTIVE = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*(['"])use (client|server)\1/;
const ONLY_IMPORT = /^\s*import\s+(['"])(server|client)-only\1/m;

/** The side a file's own name or its first lines say runs it, when they say. */
const sideOfFileName = (file: string): Side | undefined => {
  const path = file.replace(/\\/g, '/');
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (/\.server\.[cm]?[jt]sx?$/.test(name) || /^\+server\.[cm]?[jt]s$/.test(name) || /(?:^|\/)\.server\//.test(path) || /(?:^|\/)lib\/server\//.test(path)) return 'server';
  if (/\.client\.[cm]?[jt]sx?$/.test(name) || /(?:^|\/)\.client\//.test(path)) return 'browser';
  return undefined;
};

/** What a repository's files say about the side each runs on. */
class FileSides {
  readonly #rootDir: string;
  readonly #said = new Map<string, Side | undefined>();
  readonly #directive = new Map<string, Side | undefined>();
  readonly #next: boolean;
  /** Remix, or React Router as a framework, whose route modules' loaders run on the server. */
  readonly routeModules: boolean;

  constructor(rootDir: string) {
    this.#rootDir = rootDir;
    const declared = declaredPackages(rootDir);
    this.#next = declared.has('next') || NEXT_CONFIGS.some((name) => existsSync(join(rootDir, name)));
    this.routeModules = [...declared].some((name) => name.startsWith('@remix-run/') || name === '@react-router/dev');
  }

  /** The directive or the import at the top of a file, when it has one. */
  directiveOf(file: string): Side | undefined {
    if (this.#directive.has(file)) return this.#directive.get(file);
    let side: Side | undefined;
    try {
      const text = readFileSync(resolve(this.#rootDir, file), 'utf8');
      const directive = DIRECTIVE.exec(text)?.[2] ?? ONLY_IMPORT.exec(text)?.[2];
      side = directive === 'client' ? 'browser' : directive === 'server' ? 'server' : undefined;
    } catch {
      side = undefined;
    }
    this.#directive.set(file, side);
    return side;
  }

  /** The side a file is run on alone, when its name or its first lines say. */
  of(file: string): Side | undefined {
    if (this.#said.has(file)) return this.#said.get(file);
    const side = sideOfFileName(file) ?? this.directiveOf(file);
    this.#said.set(file, side);
    return side;
  }

  /** The sides a screen in a file is rendered on. */
  screenSides(file: string): readonly Side[] {
    const own = this.of(file);
    if (own !== undefined) return [own];
    if (!this.#next) return ['browser'];
    const path = file.replace(/\\/g, '/');
    // A component of the App Router is a server component unless it says otherwise.
    if (/^(?:src\/)?app\//.test(path)) return ['server'];
    if (/^(?:src\/)?pages\//.test(path)) return ['browser'];
    // Imported by either kind of component, it is rendered as that kind.
    return ['server', 'browser'];
  }
}

const NEXT_CONFIGS = ['next.config.js', 'next.config.mjs', 'next.config.cjs', 'next.config.ts', 'next.config.mts'];

/** The packages a repository's manifest declares. */
const declaredPackages = (rootDir: string): Set<string> => {
  try {
    const manifest = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
    return new Set(['dependencies', 'devDependencies', 'peerDependencies'].flatMap((section) => Object.keys(manifest[section] ?? {})));
  } catch {
    return new Set();
  }
};

/** A function's own name, the part of its id after the file. */
const nameOf = (node: GraphNode): string => {
  const at = node.id.lastIndexOf(':');
  const name = at < 0 ? node.id : node.id.slice(at + 1);
  return name.slice(name.lastIndexOf('.') + 1);
};

/** The id a request's node has as the other half's: one call, two types. */
const otherHalfId = (id: string, from: Side): string | undefined => {
  const own = REQUEST_TYPES[from];
  if (!id.startsWith(`${own}:`)) return undefined;
  const other = REQUEST_TYPES[from === 'server' ? 'browser' : 'server'];
  return `${other}:${id.slice(own.length + 1)}`;
};

/**
 * The graph with each request read by both halves of a full-stack repository
 * drawn on the side it runs on, or kept on both and paired where it runs on
 * both or nothing read says which.
 */
export const oneSidePerRequest = (graph: RepoGraph, rootDir: string): RepoGraph => {
  const byId = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const pairs: Array<{ server: GraphNode; browser: GraphNode }> = [];
  for (const node of graph.nodes) {
    if (node.type !== REQUEST_TYPES.server) continue;
    const other = byId.get(otherHalfId(node.id, 'server') ?? '');
    if (other?.type === REQUEST_TYPES.browser) pairs.push({ server: node, browser: other });
  }
  if (pairs.length === 0) return graph;

  const files = new FileSides(rootDir);
  const callers = new Map<string, string[]>();
  const rootSides = new Map<string, Set<Side>>();
  const addRoot = (id: string, side: Side): void => {
    const sides = rootSides.get(id) ?? new Set<Side>();
    sides.add(side);
    rootSides.set(id, sides);
  };
  for (const edge of graph.edges) {
    if (edge.type === 'calls') callers.set(edge.to, [...(callers.get(edge.to) ?? []), edge.from]);
    if (edge.type !== 'handles') continue;
    const from = byId.get(edge.from)?.type;
    if (from === 'ui_action') addRoot(edge.to, 'browser');
    else if (from === 'entry' || from === 'consumer') addRoot(edge.to, 'server');
  }
  for (const node of graph.nodes) {
    if (node.type === 'ui_component' && node.file !== undefined) for (const side of files.screenSides(node.file)) addRoot(node.id, side);
    if (node.type !== 'function' && node.type !== 'method' && node.type !== 'ui_component') continue;
    const name = nameOf(node);
    if (SERVER_NAMES.has(name)) addRoot(node.id, 'server');
    if (BROWSER_NAMES.has(name)) addRoot(node.id, 'browser');
    if (files.routeModules && node.type === 'function' && ROUTE_MODULE_SERVER_NAMES.has(name)) addRoot(node.id, 'server');
    // A universal `load` (SvelteKit's `+page.ts`, `+layout.ts`) and Next's
    // `getInitialProps` run on the server for the first page and in the
    // browser after it.
    if ((name === 'load' && node.file !== undefined && UNIVERSAL_LOAD.test(node.file)) || name === 'getInitialProps') {
      addRoot(node.id, 'server');
      addRoot(node.id, 'browser');
    }
  }

  /** The sides that reach a function: its file's, or its roots' and its callers'. */
  const reaching = (start: string): Set<Side> => {
    const found = new Set<Side>();
    const seen = new Set<string>();
    const queue = [start];
    while (queue.length > 0) {
      const at = queue.shift() as string;
      if (seen.has(at)) continue;
      seen.add(at);
      const file = byId.get(at)?.file;
      const own = file === undefined ? undefined : files.of(file);
      // A function in a file only one side runs is run there, whoever calls it.
      if (own !== undefined) {
        found.add(own);
        continue;
      }
      const roots = rootSides.get(at);
      if (roots !== undefined) {
        for (const side of roots) found.add(side);
        continue;
      }
      queue.push(...(callers.get(at) ?? []));
    }
    return found;
  };

  const dropped = new Set<string>();
  const paired = new Map<string, string>();
  for (const { server, browser } of pairs) {
    const sides = new Set<Side>();
    for (const holder of callers.get(server.id) ?? []) for (const side of reaching(holder)) sides.add(side);
    for (const holder of callers.get(browser.id) ?? []) for (const side of reaching(holder)) sides.add(side);
    const own = server.file === undefined ? undefined : files.of(server.file);
    const only = own ?? (sides.size === 1 ? [...sides][0] : undefined);
    if (only === 'server') dropped.add(browser.id);
    else if (only === 'browser') dropped.add(server.id);
    else {
      paired.set(server.id, browser.id);
      paired.set(browser.id, server.id);
    }
  }

  return {
    ...graph,
    nodes: graph.nodes
      .filter((node) => !dropped.has(node.id))
      .map((node) => {
        const other = paired.get(node.id);
        return other === undefined ? node : { ...node, meta: { ...node.meta, [SAME_CALL_META]: other } };
      }),
    edges: graph.edges.filter((edge) => !dropped.has(edge.from) && !dropped.has(edge.to)),
    unresolved: graph.unresolved.filter((row) => row.symbol === undefined || !dropped.has(row.symbol)),
  };
};
