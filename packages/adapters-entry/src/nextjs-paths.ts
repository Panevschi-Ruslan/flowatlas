import { normalizePath, PARAM_PLACEHOLDER } from '@flowatlas/core';

/**
 * The framework whose router is the file system, described rather than
 * implemented.
 *
 * Every other framework this tool reads registers a route by calling something:
 * a decorator, a method on an application, an entry in a table. There is always
 * a call site, and the path is an argument to it. Here there is no call at all.
 * `app/api/orders/[id]/route.ts` is served at `/api/orders/:id` because of where
 * the file is, and nothing inside the file says so. So the reader for it is not
 * a reader of expressions but a reader of paths, and the rules below are the
 * whole of it.
 *
 * Two routers, because the framework has had two and repositories have both at
 * once during the years it takes to move. They differ in one thing only: which
 * part of the path is the route, and whether the file name is part of it.
 */

/** A directory that groups files without appearing in the address. */
const GROUP = /^\(.*\)$/;

/** A slot of a layout rendered beside another, which is not a path either. */
const SLOT = /^@/;

/**
 * A folder the router refuses to serve.
 *
 * The underscore is the framework's own way of saying "this is code, not a
 * route", and it is how a repository keeps components next to the pages that
 * use them without those components becoming addresses.
 */
const PRIVATE = /^_/;

/** `[id]` is one segment of any value; `[...rest]` and `[[...rest]]` are any number. */
const DYNAMIC = /^\[(\.\.\.)?(.+?)\]$/;
const OPTIONAL_CATCH_ALL = /^\[\[\.\.\..+\]\]$/;

/**
 * One segment of a directory path, as the router reads it.
 *
 * `null` means the segment contributes nothing to the address, which is a
 * different answer from an empty string: a repository that spells a group as a
 * path serves `/api/(admin)/users` at `/api/users`, and getting that wrong
 * moves every route under it.
 */
const segmentOf = (segment: string): string | null => {
  if (segment === '') return null;
  if (GROUP.test(segment) || SLOT.test(segment)) return null;
  if (OPTIONAL_CATCH_ALL.test(segment)) return '*';
  const dynamic = DYNAMIC.exec(segment);
  if (dynamic === null) return segment;
  return dynamic[1] === undefined ? PARAM_PLACEHOLDER : '*';
};

/** Where in a repo-relative path the router's root is, and what it serves. */
export interface FsRouter {
  /** The directory whose contents are the address space. */
  readonly root: string;
  /**
   * File names that declare a route rather than contribute a segment.
   *
   * The App Router names them; the Pages Router has none, because there every
   * file is a route and its own name is the last segment.
   */
  readonly routeFiles?: readonly string[];
  /** A prefix every address under this router carries. */
  readonly prefix?: string;
}

/** `app/**\/route.ts`, where the file name says what the file is for. */
export const APP_ROUTER: FsRouter = { root: 'app', routeFiles: ['route'] };

/** `app/**\/page.tsx`, the screen at the same address. */
export const APP_PAGES: FsRouter = { root: 'app', routeFiles: ['page'] };

/**
 * `pages/api/**`, the older router, where the file name is the last segment.
 *
 * `index` is the exception: it stands for the directory it is in, which is the
 * one rule the App Router dropped by naming its route files instead.
 */
export const PAGES_API: FsRouter = { root: 'pages/api', prefix: '/api' };

const FILE_EXTENSION = /\.[cm]?[jt]sx?$/;

/**
 * The address a file is served at, or `null` when this router does not serve it.
 *
 * `file` is repo-relative and POSIX, as every path in the graph is. The root is
 * matched wherever it occurs rather than only at the start, because a
 * repository is as likely to keep its application under `src/` as at the top,
 * and both spell the same addresses.
 */
export const routePathOfFile = (file: string, router: FsRouter): string | null => {
  const parts = file.split('/');
  const rootParts = router.root.split('/');
  // The last occurrence, so a repository with a component directory called
  // `app` inside its application is not mistaken for a second router.
  let at = -1;
  for (let index = 0; index + rootParts.length <= parts.length; index += 1) {
    if (rootParts.every((part, offset) => parts[index + offset] === part)) at = index;
  }
  if (at < 0) return null;

  const after = parts.slice(at + rootParts.length);
  const name = (after.pop() ?? '').replace(FILE_EXTENSION, '');
  if (name === '') return null;

  if (router.routeFiles !== undefined) {
    if (!router.routeFiles.includes(name)) return null;
  } else {
    // The older router: the file name is the last segment, and a private file
    // is not a route at all.
    if (PRIVATE.test(name)) return null;
    if (name !== 'index') after.push(name);
  }

  // A directory the underscore opts out of routing serves nothing at all, so a
  // file under one is not a route with a segment missing — it is not a route.
  if (after.some((segment) => PRIVATE.test(segment))) return null;

  // A grouped or slot directory drops out; nothing else may, because a segment
  // that could not be read would make the address a different one.
  const kept = after.map(segmentOf).filter((segment): segment is string => segment !== null);
  return normalizePath(`${router.prefix ?? ''}/${kept.join('/')}`);
};
