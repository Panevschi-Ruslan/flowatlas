import type { FsRouter } from './fs-routes.js';

/**
 * The routers one framework has had, as rows of the description in `fs-routes.ts`.
 *
 * Two routers, because the framework has had two and repositories have both at
 * once during the years it takes to move. They differ in one thing only: which
 * part of the path is the route, and whether the file name is part of it. Neither
 * of them is a reading — the reading is shared with every other file-system
 * router this tool knows, and these three values are the whole of what is
 * particular to this framework's address space (R91).
 */

/**
 * Every segment spelling this framework has.
 *
 * All five, and it is the only router here that has all five. A group in
 * brackets and a slot behind an at-sign both drop out of the address; an
 * underscore opts a whole subtree out of routing; `[id]` is a parameter and
 * `[...rest]` is any number of segments.
 */
const NEXT_SEGMENTS = ['group', 'slot', 'private', 'param', 'catch-all'] as const;

/** `app/**\/route.ts`, where the file name says what the file is for. */
export const APP_ROUTER: FsRouter = {
  root: 'app',
  routeFiles: ['route'],
  segments: NEXT_SEGMENTS,
};

/** `app/**\/page.tsx`, the screen at the same address. */
export const APP_PAGES: FsRouter = {
  root: 'app',
  routeFiles: ['page'],
  segments: NEXT_SEGMENTS,
};

/**
 * `pages/api/**`, the older router, where the file name is the last segment.
 *
 * `index` is the exception: it stands for the directory it is in, which is the
 * one rule the App Router dropped by naming its route files instead.
 */
export const PAGES_API: FsRouter = {
  root: 'pages/api',
  prefix: '/api',
  segments: NEXT_SEGMENTS,
};

/**
 * `pages/**`, the older router's screens: every file is a page at the address
 * its path spells, `index` standing for its directory, as under `pages/api`
 * (P276). What is under `pages/api` is a way in rather than a screen, and a
 * file whose name starts with an underscore (`_app`, `_document`) is the
 * frame every page is drawn in rather than one of them; the screens reader leaves
 * both out.
 */
export const PAGES_SCREENS: FsRouter = {
  root: 'pages',
  segments: NEXT_SEGMENTS,
};
