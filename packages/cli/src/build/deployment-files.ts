import { DEPLOYMENT_READERS } from '@flowatlas/adapters-entry';

/**
 * Files that describe how a repository is deployed, repo-relative and sorted.
 *
 * A function's name, its handler and the routes in front of it are read from
 * these, not from any TypeScript source, so a change to one of them is a change
 * to the graph that the source listing would never see: the build would answer
 * `0 files changed` and serve the old routes. They are stamped with the sources
 * and counted as global, because what a deployment says decides which handlers
 * are ways in at all, and that is not something a partial read can redo.
 */
export const deploymentFiles = (repoDir: string): string[] =>
  [...new Set(DEPLOYMENT_READERS.flatMap((reader) => reader.files(repoDir)))].sort();
