import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FlowatlasConfig, ServiceConfig } from '@flowatlas/core';
import { deploymentReadersFor, sourceOfOutput } from './deployed-functions.js';

/**
 * The source directory a deployment's packaged directory stands for, or nothing
 * when it is outside the repository or not there.
 *
 * Compiled output is mapped back first, by the tsconfig that wrote it, exactly as
 * a handler is found: a function packaged from `dist/returns` runs the code in
 * `src/returns`, and the `dist` a build left behind is not that code.
 */
const sourceDirectoryOf = (repoDir: string, directory: string): string | undefined => {
  if (directory.startsWith('../')) return undefined;
  const mapped = sourceOfOutput(repoDir, directory)?.directory;
  if (mapped !== undefined) return mapped;
  return existsSync(join(repoDir, directory)) ? directory : undefined;
};

/**
 * The directories a repository's deployment packages its functions from,
 * repo-relative and sorted (R170).
 *
 * A repository of functions very often keeps its handlers beside `src/` - in
 * `functions/`, `lambdas/` or `handlers/` - and its tsconfig may not name them,
 * because each function is bundled on its own. The deployment does name them:
 * it is where the code it runs is packaged from. These are source roots of the
 * service, handed to both the reading and the build's file listing so that the
 * two open and stamp the same files. A repository whose deployment is not read
 * here has none.
 */
export const deployedSourceDirectories = (
  repoDir: string,
  config: FlowatlasConfig,
  service?: ServiceConfig,
): string[] => {
  const packaged = deploymentReadersFor(repoDir, config).flatMap((reader) =>
    reader
      .read({ repoDir, config, ...(service === undefined ? {} : { service }) })
      .functions.flatMap((fn) => fn.handler?.directory ?? []),
  );
  return [...new Set(packaged.flatMap((dir) => sourceDirectoryOf(repoDir, dir) ?? []))].sort();
};
