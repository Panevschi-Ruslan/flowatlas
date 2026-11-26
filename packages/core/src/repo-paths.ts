import { resolve } from 'node:path';
import type { Project, SourceFile } from 'ts-morph';

/** A path with forward slashes, as the project of source files writes every path. */
const forward = (path: string): string => path.replace(/\\/g, '/');

/**
 * The ways a repository's directory may begin a source file's path, without a
 * trailing slash: resolved, and as given. On Windows resolving adds the drive
 * (`D:/web`) and backslashes, which a project of source files never writes:
 * its paths have forward slashes, and an in-memory one is rooted at the
 * directory as given (`/web`). Compared with `resolve(repoDir) + sep`, a file
 * was never found there, and its repository-relative path stayed absolute.
 */
const rootsOf = (repoDir: string): string[] =>
  [...new Set([forward(resolve(repoDir)), forward(repoDir)])].map((root) => (root.endsWith('/') ? root.slice(0, -1) : root));

/** A source file's path relative to its repository, with forward slashes; the path as it is where it lies outside. */
export const repoRelativeOf = (repoDir: string, filePath: string): string => {
  const path = forward(filePath);
  for (const root of rootsOf(repoDir)) if (path.startsWith(`${root}/`)) return path.slice(root.length + 1);
  return path;
};

/** Whether a source file lies under the repository's directory, on any platform. */
export const inRepo = (repoDir: string, filePath: string): boolean => {
  const path = forward(filePath);
  return rootsOf(repoDir).some((root) => path.startsWith(`${root}/`));
};

/** The source file at a repository-relative path, on any platform. */
export const sourceFileIn = (project: Pick<Project, 'getSourceFile'>, repoDir: string, file: string): SourceFile | undefined => {
  for (const root of rootsOf(repoDir)) {
    const found = project.getSourceFile(`${root}/${forward(file)}`);
    if (found !== undefined) return found;
  }
  return undefined;
};
