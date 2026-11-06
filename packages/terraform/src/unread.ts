import { readFileSync } from 'node:fs';
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
 * were rows until P57 read them.
 */
export const UNREAD_DEPLOYMENTS: ReadonlyArray<readonly [name: string, test: (repoDir: string) => boolean]> = [
  [
    'AWS SAM',
    (dir) =>
      ['template.yaml', 'template.yml'].some((file) => {
        try {
          return /AWS::Serverless/.test(readFileSync(join(dir, file), 'utf8'));
        } catch {
          return false;
        }
      }),
  ],
];

/** The deployment tool a repository's functions are declared with, when nothing here reads it. */
export const unreadDeploymentOf = (repoDir: string): string | undefined =>
  UNREAD_DEPLOYMENTS.find(([, test]) => test(repoDir))?.[0];
