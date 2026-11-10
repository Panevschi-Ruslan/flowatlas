import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseConfig, type Deployment } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { cdkReader } from './index.js';

/** What a CDK app grants a function (P272). */
const stack = (body: string): Deployment => {
  const repoDir = mkdtempSync(join(tmpdir(), 'flowatlas-cdk-grants-'));
  const files: Record<string, string> = {
    'cdk.json': JSON.stringify({ app: 'npx ts-node bin/app.ts' }),
    'bin/app.ts': "import { App } from 'aws-cdk-lib';\nimport { AppStack } from '../lib/stack';\nconst app = new App();\nnew AppStack(app, 'App');\n",
    'lib/stack.ts': [
      "import * as path from 'path';",
      "import * as cdk from 'aws-cdk-lib';",
      "import { aws_lambda as lambda, aws_sqs as sqs, aws_sns as sns, aws_iam as iam } from 'aws-cdk-lib';",
      "import { Construct } from 'constructs';",
      'export class AppStack extends cdk.Stack {',
      '  constructor(scope: Construct, id: string) {',
      '    super(scope, id);',
      body,
      '  }',
      '}',
    ].join('\n'),
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repoDir, path)), { recursive: true });
    writeFileSync(join(repoDir, path), text);
  }
  return cdkReader.read({ repoDir, config: parseConfig({}), service: { name: 'app', repo: repoDir, type: 'lambda' } });
};

const FN = `const move = new lambda.Function(this, 'Move', { functionName: 'stock-move', runtime: lambda.Runtime.NODEJS_20_X, code: lambda.Code.fromAsset(path.join(__dirname, '..', 'src')), handler: 'move.handler' });`;

describe('what a CDK function is granted', () => {
  it('reads a construct\'s grant to it and a statement added to its role, and leaves a grant to read out', () => {
    const deployment = stack(`${FN}
    const restock = new sqs.Queue(this, 'Restock', { queueName: 'stock-restock' });
    const writeOff = new sqs.Queue(this, 'WriteOff', { queueName: 'stock-write-off' });
    const notices = new sns.Topic(this, 'Notices', { topicName: 'stock-notices' });
    restock.grantSendMessages(move);
    notices.grantPublish(move.role);
    writeOff.grantConsumeMessages(move);
    move.addToRolePolicy(new iam.PolicyStatement({ actions: ['sqs:SendMessage'], resources: [writeOff.queueArn, 'arn:aws:sqs:*:*:*'] }));`);
    const grants = (deployment.functions[0]?.grants ?? []).map(({ kind, name, any, by }) => ({ kind, ...(name === undefined ? {} : { name }), ...(any === undefined ? {} : { any }), by }));
    expect(grants).toEqual([
      { kind: 'queue', name: 'stock-restock', by: 'grantSendMessages' },
      { kind: 'topic', name: 'stock-notices', by: 'grantPublish' },
      { kind: 'queue', name: 'stock-write-off', by: 'PolicyStatement' },
      { kind: 'queue', any: 'arn:aws:sqs:*:*:*', by: 'PolicyStatement' },
    ]);
  });
});
