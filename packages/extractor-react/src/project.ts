import { createProject, type CreateProjectOptions, type SourceRootOptions } from '@flowatlas/core';
import type { Project } from 'ts-morph';

/**
 * Where a repository written in this framework keeps its code, when its tsconfig
 * does not say.
 *
 * The whole repository rather than `src`, because a browser repository keeps its
 * screens wherever its framework's convention puts them, and a `src` directory
 * next to an `app` one must not narrow the reading to `src`. Where the tsconfig
 * names its roots, they are the answer here as for every reader (R170).
 *
 * Exported so the build's file listing asks the same question the reading does:
 * a fallback this package kept to itself would be files the reader opens and the
 * build never stamps.
 */
export const REACT_SOURCE_ROOTS: Readonly<Pick<SourceRootOptions, 'fallback'>> = Object.freeze({
  fallback: 'repository',
});

/**
 * Parses a repository the way this extractor needs it.
 *
 * Exported because the command line opens some repositories itself, and a
 * repository opened from a source root is a repository whose screens may be
 * outside it.
 */
export const createReactProject = (options: CreateProjectOptions): Project =>
  createProject({ ...REACT_SOURCE_ROOTS, ...options });
