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

describe("a stream event's failure destination (P264)", () => {
  it('hands what a stream event gives up on to the destination it names, of the kind its type says', () => {
    const deployment = read(
      `${PROVIDER}functions:\n  tally:\n    handler: src/tally.handler\n    events:\n      - stream:\n          type: kinesis\n          arn: arn:aws:kinesis:eu-west-1:1:stream/shop-clicks\n          destinations:\n            onFailure:\n              arn: \${cf:platform.FailedTopic}\n              type: sns\n      - stream:\n          type: kinesis\n          arn: arn:aws:kinesis:eu-west-1:1:stream/shop-views\n          destinations:\n            onFailure: arn:aws:sqs:eu-west-1:1:shop-failed\n`,
    );
    const failures = deployment.deliveries.filter((delivery) => delivery.by === 'destination').map((delivery) => [delivery.address, delivery.from, delivery.to]);
    expect(failures).toEqual([
      ['functions.tally.events[0].destinations.onFailure', { kind: 'outcome', when: 'failure', of: { delivery: 'functions.tally.events[0]' } }, { kind: 'topic', name: importedName(stackOutputKey('platform', 'FailedTopic')) }],
      ['functions.tally.events[1].destinations.onFailure', { kind: 'outcome', when: 'failure', of: { delivery: 'functions.tally.events[1]' } }, { kind: 'queue', name: 'shop-failed' }],
    ]);
    expect(deployment.imports).toEqual([expect.objectContaining({ key: stackOutputKey('platform', 'FailedTopic'), kinds: ['topic'] })]);
  });
});
