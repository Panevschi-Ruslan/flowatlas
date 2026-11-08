import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importedName, parseConfig, stackOutputKey, type Deployment } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { serverlessReader } from './index.js';

const read = (service: string): Deployment => {
  const repoDir = mkdtempSync(join(tmpdir(), 'flowatlas-serverless-shared-'));
  writeFileSync(join(repoDir, 'serverless.yml'), service);
  return serverlessReader.read({ repoDir, config: parseConfig({}), service: { name: 'svc', repo: repoDir, type: 'lambda' } });
};

const PROVIDER = 'service: shop\nprovider:\n  name: aws\n  runtime: nodejs20.x\n  stage: prod\n  region: eu-west-1\n';

describe('two values other deployments publish in one string (P259)', () => {
  it('reads an address whose account and name are each an import as the imported name, the account aside', () => {
    const deployment = read(`${PROVIDER}functions:\n  close:\n    handler: src/close.handler\n    environment:\n      QUEUE_URL: https://sqs.\${aws:region}.amazonaws.com/\${ssm:/shop/account}/\${cf:billing.QueueName}\n`);
    const key = stackOutputKey('billing', 'QueueName');
    expect(deployment.functions[0]?.environment?.['QUEUE_URL']?.names).toEqual({ kind: 'queue', name: importedName(key) });
    expect(deployment.imports).toEqual([expect.objectContaining({ key, kinds: ['queue'], as: 'name' })]);
  });

  it('reads a name built of two imports and text as the name to finish, each part an import within it', () => {
    const deployment = read(`${PROVIDER}functions:\n  close:\n    handler: src/close.handler\n    environment:\n      JOBS: arn:aws:sqs:eu-west-1:1:\${ssm:/shop/prefix}-\${ssm:/shop/stage}-jobs\n`);
    const name = `${importedName('parameter:/shop/prefix')}-${importedName('parameter:/shop/stage')}-jobs`;
    expect(deployment.functions[0]?.environment?.['JOBS']?.names).toEqual({ kind: 'queue', name });
    expect(deployment.imports?.map((site) => [site.key, site.within])).toEqual([
      ['parameter:/shop/prefix', name],
      ['parameter:/shop/stage', name],
    ]);
  });
});
