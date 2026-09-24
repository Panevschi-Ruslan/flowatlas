import { createProject, type CreateProjectOptions } from '@flowatlas/core';
import type { Project } from 'ts-morph';

/**
 * The files a repository written in this framework keeps its code in.
 *
 * The server readers glob `.ts` alone, which is right for them: a NestJS
 * controller is never written in `.tsx`. Here it is the other way round. A
 * React component lives in a file whose extension exists precisely because the
 * file holds markup, so a reader that leaves `.tsx` out reads the API modules
 * and none of the screens they were written for — and a screen is the thing
 * this extractor exists to reach.
 *
 * It is also not only the screens: eleven of the five hundred and twenty route
 * handlers in the repository this was measured against are `.tsx`, because a
 * route that answers with an image is written in markup too.
 */
export const REACT_SOURCE_GLOBS = ['**/*.ts', '**/*.tsx'] as const;

/**
 * Parses a repository the way this extractor needs it.
 *
 * Exported because the command line opens some repositories itself, and a
 * repository opened without these globs is a repository with no components in
 * it. The globs are relative to the source root the core picks, so a repository
 * with a `src` directory and one without are both read.
 */
export const createReactProject = (options: CreateProjectOptions): Project => {
  const sourceRoot = options.include ?? REACT_SOURCE_GLOBS;
  return createProject({ ...options, include: [...sourceRoot] });
};
