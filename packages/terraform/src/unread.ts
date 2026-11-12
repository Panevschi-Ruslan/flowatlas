import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Descriptions of a deployment nothing here reads, by the file that gives each
 * away.
 *
 * Knowing the name of a stack that is not read is worth as much as knowing one
 * that is (R18): a repository whose functions are declared this way is told
 * which tool its deployment is written for, rather than reading as a repository
 * with nothing in it. Each is a row here, and becomes a reader of its own by
 * implementing `DeploymentReader`: the Serverless Framework and the AWS CDK
 * were rows until P57 read them, AWS SAM until P246.
 */
export const UNREAD_DEPLOYMENTS: ReadonlyArray<readonly [name: string, test: (repoDir: string) => boolean]> = [
  ['SST', (dir) => ['sst.config.ts', 'sst.config.js', 'sst.config.mjs'].some((file) => existsSync(join(dir, file)))],
  ['Architect', (dir) => ['app.arc', 'arc.json', 'arc.yaml'].some((file) => existsSync(join(dir, file)))],
];

/** The deployment tool a repository's functions are declared with, when nothing here reads it. */
export const unreadDeploymentOf = (repoDir: string): string | undefined =>
  UNREAD_DEPLOYMENTS.find(([, test]) => test(repoDir))?.[0];
