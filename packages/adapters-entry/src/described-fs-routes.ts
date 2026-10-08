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
import { handlerOfFunction, repoSources } from './shared.js';

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
  readonly request: RequestReadingDescription;
  /** What the entry's `registration` says it was declared by. */
  readonly registration: string;
}

/** The entry adapter one description reads as. */
export const fsRoutesAdapter = (description: FsRoutesDescription): EntryAdapter => {
  const request = readingOf(description.request);
  const files = (ctx: ExtractContext): string[] =>
    [...repoSources(ctx)].map((source) => normalizeFilePath(source.getFilePath(), ctx.repoDir));
  const applicationsOf = (ctx: ExtractContext) => fsApplicationMap(files(ctx), [description.router]);

  return {
    name: description.name,
    detect: (pkg) => hasAnyDependency(pkg, [...description.packages]),
    applications: (ctx) => applicationsOf(ctx),

    extractEntries(ctx: ExtractContext): EntryNode[] {
      const entries: EntryNode[] = [];
      const seen = new Set<string>();
      const httpEntry = (verb: FsRouteVerb, application: string | undefined): void => {
        const key = makeHttpEntryKey(verb.method, verb.path);
        const id = makeEntryId(ctx.repo, 'http', key, application);
        if (seen.has(id)) return;
        seen.add(id);
        entries.push({
          id,
          kind: 'http',
          label:
            application === undefined
              ? `${verb.method} ${verb.path}`
              : `${verb.method} ${verb.path} (${application})`,
          key,
          ...(verb.handler === undefined ? {} : { handler: handlerOfFunction(verb.handler, ctx) }),
          request,
          file: verb.at.reached.file,
          line: verb.at.reached.line,
          meta: {
            method: verb.method,
            path: verb.path,
            ...(verb.rawPath === undefined ? {} : { rawPath: verb.rawPath }),
            adapter: description.name,
            registration: description.registration,
            ...(application === undefined ? {} : { application }),
            handlerVia: verb.handlerVia,
            ...(verb.bodyRead ? {} : { handlerBodyRead: false }),
            ...reachMeta(verb.at),
          },
        });
      };

      const space = fsAddressSpace(applicationsOf(ctx));
      for (const sourceFile of repoSources(ctx)) {
        const file = normalizeFilePath(sourceFile.getFilePath(), ctx.repoDir);
        const address = space.addressOf(file, description.router);
        if (address === null) continue;
        readVerbFile(ctx, sourceFile, {
          file,
          path: address.path,
          rawPath: address.rawPath,
          adapter: description.name,
          emit: (verb) => httpEntry(verb, address.application),
          ...(description.verbs === undefined ? {} : { verbs: description.verbs }),
          ...(description.pagesServed === true ? { pagesServed: true } : {}),
        });
      }
      return entries;
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
  calls: [{ param: 0, at: ['request'], method: 'json', part: 'body' as const }],
} satisfies Pick<RequestReadingDescription, 'parts' | 'calls'>;

/**
 * SvelteKit: `src/routes/**\/+server.ts`, exporting its verbs by name. A group
 * in brackets drops out, `[id]` and `[[id]]` are params (a matcher after `=` is
 * no part of the name) and `[...rest]` is the rest of the path.
 */
export const SVELTEKIT_ROUTES: FsRouter = {
  root: 'src/routes',
  routeFiles: ['+server'],
  segments: ['group', 'param', 'catch-all'],
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
 * the one a form sends.
 */
const REMIX_VERBS: ReadonlyMap<string, string> = new Map([
  ['loader', 'GET'],
  ['action', 'POST'],
]);

export const sveltekitRoutesAdapter = fsRoutesAdapter({
  name: 'sveltekit-routes',
  packages: ['@sveltejs/kit'],
  router: SVELTEKIT_ROUTES,
  registration: 'routes/+server',
  request: {
    ...EVENT_REQUEST,
    answers: [{ by: 'named', callee: 'json', statusKey: 'status' }],
  },
});

export const remixRoutesAdapter = fsRoutesAdapter({
  name: 'remix-routes',
  packages: ['@remix-run/node', '@remix-run/react', '@remix-run/server-runtime'],
  router: REMIX_ROUTES,
  verbs: REMIX_VERBS,
  pagesServed: true,
  registration: 'routes/loader-action',
  request: {
    ...EVENT_REQUEST,
    answers: [{ by: 'named', callee: 'json', statusKey: 'status' }, { by: 'return' }],
  },
});
