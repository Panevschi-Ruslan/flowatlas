import {
  hasAnyDependency,
  makeEntryId,
  makeHttpEntryKey,
  normalizeFilePath,
  reachMeta,
  type EntryAdapter,
  type EntryNode,
  type ExtractContext,
  type RequestReadingDescription,
} from '@flowatlas/core';
import { fsAddressSpace, fsApplicationMap, readVerbFile, type FsRouter, type FsRouteVerb } from './fs-routes.js';
import { readingOf } from './request-readings.js';
import { handlerOfFunction, inlineHandlerOf, repoSources } from './shared.js';

/**
 * A file-system router whose whole reading is a description (P38).
 *
 * Next.js and Medusa have readers of their own because each has something
 * beside its routes - server actions, a middleware list. The routers here have
 * nothing beside them that this tool reads, so each is a row: the packages that
 * give it away, where its routes are and how its segments are spelled, which
 * exports are ways in, and how a handler is handed its request.
 */
export interface FsRoutesDescription {
  readonly name: string;
  readonly packages: readonly string[];
  readonly router: FsRouter;
  /** The exports that are ways in, and the verb each answers; the verbs' own names when absent. */
  readonly verbs?: ReadonlyMap<string, string>;
  /** Whether a route module that exports no way in is a page and says nothing. */
  readonly pagesServed?: boolean;
  /**
   * The route files whose ways in are other exports than the rest's, by file
   * name: SvelteKit's `+page.server` answers by `load` and `actions`, not by
   * verbs (P42).
   */
  readonly files?: ReadonlyMap<string, FsRouteExports>;
  /** Exports whose verbs are the literals the handler compares `request.method` to (P43). */
  readonly narrowed?: ReadonlySet<string>;
  readonly request: RequestReadingDescription;
  /** What the entry's `registration` says it was declared by. */
  readonly registration: string;
}

/** Which exports of one kind of route file are ways in. */
export interface FsRouteExports {
  readonly verbs: ReadonlyMap<string, string>;
  /** Exports that are objects of ways in, and the verb each member answers. */
  readonly actions?: ReadonlyMap<string, string>;
  readonly pagesServed?: boolean;
  /** What the entry's `registration` says, where it is not the router's. */
  readonly registration?: string;
  /**
   * How these files answer, where it is not the router's: a SvelteKit `load`
   * answers with the data it returns (P47).
   */
  readonly request?: RequestReadingDescription;
  /**
   * What these ways in contribute to rather than answer by themselves. A
   * layout's `load` runs for every page beneath it and is no address's GET; a
   * page's `load` answers a browser's navigation, and gives way to a `+server`
   * GET at the same address, which is what a request from code reaches.
   */
  readonly contributes?: FsContribution;
}

/** What a way in contributes to, where it answers no request of its own. */
export type FsContribution = 'page' | 'layout';


const FILE_NAME = /^(?:.*\/)?([^/]+?)\.[cm]?[jt]sx?$/;

/** The exports one route file is read by: its own row, or the router's. */
const fileNameOf = (file: string): string | undefined => FILE_NAME.exec(file)?.[1];

const exportsOf = (file: string, description: FsRoutesDescription): FsRouteExports | undefined => {
  const name = fileNameOf(file);
  return name === undefined ? undefined : description.files?.get(name);
};

/** The ways in one reading collects, each once, and how one is added. */
export interface FsEntries {
  /** Every way in, each claim settled: read once every file has been added. */
  readonly entries: () => EntryNode[];
  readonly add: (
    verb: FsRouteVerb,
    application: string | undefined,
    registration: string,
    own?: EntryNode['request'],
    claim?: FsClaim,
  ) => void;
}

/** Which route file a way in was declared by, and what it contributes to. */
export interface FsClaim {
  readonly file: string;
  readonly contributes?: FsContribution;
}

/** A way in read, before what else claims its address is known. */
interface Candidate {
  readonly entry: EntryNode;
  readonly claim: FsClaim | undefined;
}

/** The entry a contribution is, beside the way in that answers its address. */
const contributing = (entry: EntryNode, contributes: FsContribution, suffix: string): EntryNode => ({
  ...entry,
  id: `${entry.id}#${suffix}`,
  key: `${entry.key}#${suffix}`,
  label: `${entry.label} (${contributes})`,
  meta: { ...entry.meta, contributes },
});

/**
 * How the ways in claiming one address are settled, by what they contribute:
 * a layout never answers it and is its own entry, a page gives way to a verb
 * beside it, and two that answer it alike are a duplicate claim, the first kept
 * and the rest said. Nothing is dropped in silence.
 */
const settle = (
  ctx: ExtractContext,
  adapter: string,
  claims: readonly Candidate[],
): EntryNode[] => {
  const byRole = (contributes: FsContribution | undefined) =>
    claims.filter((candidate) => candidate.claim?.contributes === contributes);
  const verbs = byRole(undefined);
  const pages = byRole('page');
  // The first of each kind answers; the rest of that kind claim it again.
  const firstOf = (kind: readonly Candidate[]): Candidate | undefined => {
    const [first, ...rest] = kind;
    for (const duplicate of rest) reportDuplicateClaim(ctx, adapter, duplicate, first as Candidate);
    return first;
  };
  const verb = firstOf(verbs);
  const page = firstOf(pages);
  const settled: EntryNode[] = [];
  if (verb !== undefined) settled.push(verb.entry);
  if (page !== undefined) settled.push(verb === undefined ? page.entry : contributing(page.entry, 'page', 'page'));
  // A layout is named by its file: two groups may each lay out the same address.
  for (const layout of byRole('layout')) {
    settled.push(contributing(layout.entry, 'layout', `layout:${layout.claim?.file ?? ''}`));
  }
  return settled;
};

const reportDuplicateClaim = (
  ctx: ExtractContext,
  adapter: string,
  duplicate: Candidate,
  kept: Candidate,
): void => {
  const file = duplicate.claim?.file ?? duplicate.entry.file ?? '';
  ctx.builder.addUnresolved({
    file,
    line: duplicate.entry.line ?? 1,
    reason: 'route-claimed-twice',
    message: `${file} answers ${duplicate.entry.label}, which ${kept.claim?.file ?? kept.entry.file ?? 'another file'} already answers, so only the first is drawn.`,
    hint: 'Two route files resolve to one address; the framework refuses that or serves one of them. Remove one, or move it to the address it was meant for.',
    symbol: duplicate.entry.label,
    adapter,
  });
};

/**
 * The entries of a router whose ways in are route modules, built one way for
 * every such router: the rows above and a route config alike (P43).
 */
export const fsEntries = (
  ctx: ExtractContext,
  adapter: string,
  request: EntryNode['request'],
): FsEntries => {
  const claims = new Map<string, Candidate[]>();
  const add = (
    verb: FsRouteVerb,
    application: string | undefined,
    registration: string,
    own: EntryNode['request'] = request,
    claim?: FsClaim,
  ): void => {
    // A named action is posted to the page's address with `?/name` after
    // it; the query is kept out of the path, so params are named as before.
    const query = verb.action === undefined ? '' : `?/${verb.action}`;
    const key = `${makeHttpEntryKey(verb.method, verb.path)}${query}`;
    const id = makeEntryId(ctx.repo, 'http', key, application);
    // One file read twice (a route config naming a module twice) is one claim.
    const same = claims.get(id) ?? [];
    if (same.some((candidate) => candidate.claim?.file === claim?.file)) return;
    const label = `${verb.method} ${verb.path}${query}`;
    const handler =
      verb.handler !== undefined ? handlerOfFunction(verb.handler, ctx) : inlineHandlerOf(verb.inline, label, ctx);
    const entry: EntryNode = {
      id,
      kind: 'http',
      label: application === undefined ? label : `${label} (${application})`,
      key,
      ...(handler === undefined ? {} : { handler }),
      ...(own === undefined ? {} : { request: own }),
      file: verb.at.reached.file,
      line: verb.at.reached.line,
      meta: {
        method: verb.method,
        path: verb.path,
        ...(verb.rawPath === undefined ? {} : { rawPath: verb.rawPath }),
        ...(verb.action === undefined ? {} : { action: verb.action }),
        adapter,
        registration,
        ...(application === undefined ? {} : { application }),
        handlerVia: verb.handlerVia,
        ...(verb.bodyRead ? {} : { handlerBodyRead: false }),
        ...reachMeta(verb.at),
      },
    };
    claims.set(id, [...same, { entry, claim }]);
  };
  const entries = (): EntryNode[] => [...claims.values()].flatMap((claimed) => settle(ctx, adapter, claimed));
  return { entries, add };
};

/** The entry adapter one description reads as. */
export const fsRoutesAdapter = (description: FsRoutesDescription): EntryAdapter => {
  const request = readingOf(description.request);
  const files = (ctx: ExtractContext): string[] =>
    [...repoSources(ctx)].map((source) => normalizeFilePath(source.getFilePath(), ctx.repoDir));
  const applicationsOf = (ctx: ExtractContext) => fsApplicationMap(files(ctx), [description.router]);
  const fileRequests = new Map(
    [...(description.files ?? new Map<string, FsRouteExports>())].flatMap(([name, own]) =>
      own.request === undefined ? [] : [[name, readingOf(own.request)] as const],
    ),
  );

  return {
    name: description.name,
    detect: (pkg) => hasAnyDependency(pkg, [...description.packages]),
    applications: (ctx) => applicationsOf(ctx),

    extractEntries(ctx: ExtractContext): EntryNode[] {
      const requestOf = (file: string) => {
        const name = fileNameOf(file);
        return name === undefined ? undefined : fileRequests.get(name);
      };
      const collected = fsEntries(ctx, description.name, request);

      const space = fsAddressSpace(applicationsOf(ctx));
      for (const sourceFile of repoSources(ctx)) {
        const file = normalizeFilePath(sourceFile.getFilePath(), ctx.repoDir);
        const address = space.addressOf(file, description.router);
        if (address === null) continue;
        const own = exportsOf(file, description);
        const verbs = own?.verbs ?? description.verbs;
        const pagesServed = own === undefined ? description.pagesServed : own.pagesServed;
        readVerbFile(ctx, sourceFile, {
          file,
          path: address.path,
          rawPath: address.rawPath,
          adapter: description.name,
          emit: (verb) =>
            collected.add(
              verb,
              address.application,
              own?.registration ?? description.registration,
              requestOf(file) ?? request,
              { file, ...(own?.contributes === undefined ? {} : { contributes: own.contributes }) },
            ),
          ...(verbs === undefined ? {} : { verbs }),
          ...(pagesServed === true ? { pagesServed: true } : {}),
          ...(own?.actions === undefined ? {} : { actions: own.actions }),
          ...(description.narrowed === undefined ? {} : { narrowed: description.narrowed }),
        });
      }
      return collected.entries();
    },
  };
};

/**
 * The event a SvelteKit or Remix handler is handed: `({ params, request })`.
 *
 * The params are the event's; the body is whatever `await request.json()` is
 * said to be. Both answer through a `json(x, { status })` of their own, and a
 * Remix loader may return the value itself.
 */
const EVENT_REQUEST = {
  parts: { params: [{ param: 0, at: ['params'] }] },
  calls: [
    { param: 0, at: ['request'], method: 'json', part: 'body' as const },
    { param: 0, at: ['request'], method: 'formData', part: 'body' as const },
  ],
} satisfies Pick<RequestReadingDescription, 'parts' | 'calls'>;

/**
 * SvelteKit: `src/routes/**\/+server.ts`, exporting its verbs by name, and the
 * `+page.server.ts` / `+layout.server.ts` beside a page, whose `load` answers
 * the page's GET and whose `actions` its form POSTs (P42). A group in brackets
 * drops out, `[id]` and `[[id]]` are params (a matcher after `=` is no part of
 * the name), so is a segment holding one (`foo-[id]`), `[x+2e]` is an escaped
 * character and `[...rest]` is the rest of the path.
 */
export const SVELTEKIT_ROUTES: FsRouter = {
  root: 'src/routes',
  routeFiles: ['+server', '+page.server', '+layout.server'],
  segments: ['group', 'mixed', 'param', 'catch-all'],
};

/**
 * Remix's flat routes: `app/routes/api.orders.$id.ts`, or the same name as a
 * folder holding `route.ts`. A leading underscore is a layout that adds no
 * segment, `$id` a param, `$` the rest of the path.
 */
export const REMIX_ROUTES: FsRouter = {
  root: 'app/routes',
  routeFiles: ['route'],
  segments: ['pathless', 'dollar'],
  layout: 'flat',
};

/**
 * A loader answers a GET; an action answers every other verb, and is keyed by
 * the ones it compares `request.method` to, or by the POST a form sends when it
 * compares none (P43).
 */
export const REMIX_VERBS: ReadonlyMap<string, string> = new Map([
  ['loader', 'GET'],
  ['action', 'POST'],
]);

/**
 * A page's server module: `load` is its GET, and each of `actions` a POST to it
 * - the default at the page's address, a named one at `?/name`. A page module
 * exporting neither only renders, as a layout's usually does.
 */
const SVELTEKIT_ANSWERS = [{ by: 'named' as const, callee: 'json', statusKey: 'status' }];

/**
 * A page's `load` and its actions answer with what they return: the page's
 * data, or what the form is handed back (P47).
 */
const SVELTEKIT_PAGE_REQUEST: RequestReadingDescription = {
  ...EVENT_REQUEST,
  answers: [...SVELTEKIT_ANSWERS, { by: 'return' }],
};

const SVELTEKIT_PAGE: FsRouteExports = {
  verbs: new Map([['load', 'GET']]),
  request: SVELTEKIT_PAGE_REQUEST,
  actions: new Map([['actions', 'POST']]),
  pagesServed: true,
  registration: 'routes/+page.server',
  contributes: 'page',
};

/** The export whose verbs are the ones it branches on. */
export const REMIX_NARROWED: ReadonlySet<string> = new Set(['action']);

/**
 * How a Remix or React Router route module is handed its request, and answers.
 * The same for a route found by its file name and one a route config names.
 */
export const REMIX_REQUEST: RequestReadingDescription = {
  ...EVENT_REQUEST,
  // React Router's `data(x, { status })` is the `json` it replaced.
  answers: [
    { by: 'named', callee: 'json', statusKey: 'status' },
    { by: 'named', callee: 'data', statusKey: 'status' },
    { by: 'return' },
  ],
};

export const sveltekitRoutesAdapter = fsRoutesAdapter({
  name: 'sveltekit-routes',
  packages: ['@sveltejs/kit'],
  router: SVELTEKIT_ROUTES,
  files: new Map([
    ['+page.server', SVELTEKIT_PAGE],
    [
      '+layout.server',
      {
        verbs: SVELTEKIT_PAGE.verbs,
        pagesServed: true,
        registration: 'routes/+layout.server',
        request: SVELTEKIT_PAGE_REQUEST,
        contributes: 'layout',
      },
    ],
  ]),
  registration: 'routes/+server',
  request: {
    ...EVENT_REQUEST,
    answers: SVELTEKIT_ANSWERS,
  },
});

export const remixRoutesAdapter = fsRoutesAdapter({
  name: 'remix-routes',
  packages: ['@remix-run/node', '@remix-run/react', '@remix-run/server-runtime'],
  router: REMIX_ROUTES,
  verbs: REMIX_VERBS,
  narrowed: REMIX_NARROWED,
  pagesServed: true,
  registration: 'routes/loader-action',
  request: REMIX_REQUEST,
});
