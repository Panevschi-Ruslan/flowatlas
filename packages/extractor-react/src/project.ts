import { createProject, type CreateProjectOptions } from '@flowatlas/core';
import type { Project } from 'ts-morph';

/**
 * The files a repository written in this framework keeps its code in.
 *
 * Both kinds, which is now what every reader opens by default — a component
 * lives in a file whose extension exists precisely because the file holds
 * markup, and eleven of the five hundred and twenty route handlers in the
 * repository this was measured against are `.tsx` for the same reason, because
 * a route that answers with an image is written in markup too.
 *
 * What these globs still say that the default does not is *where* to look:
 * they are relative to the repository root rather than to the source root the
 * core picks, because a browser repository keeps its screens wherever its
 * framework's convention puts them, and a `src` directory next to an `app` one
 * must not narrow the reading to `src`.
 */
export const REACT_SOURCE_GLOBS = ['**/*.ts', '**/*.tsx'] as const;

/**
 * Parses a repository the way this extractor needs it.
 *
 * Exported because the command line opens some repositories itself, and a
 * repository opened from a source root is a repository whose screens may be
 * outside it.
 */
export const createReactProject = (options: CreateProjectOptions): Project => {
  const sourceRoot = options.include ?? REACT_SOURCE_GLOBS;
  return createProject({ ...options, include: [...sourceRoot] });
};
