import { DEPLOYMENT_READERS } from '@flowatlas/adapters-entry';
import type { DeploymentReadOptions } from '@flowatlas/core';
import { definitionFiles } from '@flowatlas/stepfunctions';

/**
 * Files that describe how a repository is deployed or what it runs, rather than
 * how it is coded, repo-relative and sorted.
 *
 * A function's name, its handler and the routes in front of it are read from
 * the deployment, and a state machine from its definition, not from any
 * TypeScript source, so a change to one of them is a change to the graph that
 * the source listing would never see: the build would answer `0 files changed`
 * and serve the old routes or the old workflow. They are stamped with the
 * sources and counted as global, because what they say decides which handlers
 * are ways in at all and which steps reach into them, and that is not something
 * a partial read can redo.
 *
 * `reading` is what the deployment is read with - the configuration, the
 * service - because a file a deployment loads is found by reading it.
 */
export const deploymentFiles = (repoDir: string, reading?: Omit<DeploymentReadOptions, 'repoDir'>): string[] =>
  [
    ...new Set([
      ...DEPLOYMENT_READERS.flatMap((reader) => reader.files(repoDir, reading)),
      ...definitionFiles(repoDir),
    ]),
  ].sort();
