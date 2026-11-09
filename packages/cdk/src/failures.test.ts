import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { alternativeAddress, importedName, parseConfig, type Deployment } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { cdkReader } from './index.js';

/** One stack, `shop-ledger`, of one constructor body, with a function `tally`. */
const stack = (body: string): Deployment => {
  const repoDir = mkdtempSync(join(tmpdir(), 'flowatlas-cdk-failures-'));
  const files: Record<string, string> = {
    'cdk.json': JSON.stringify({ app: 'npx ts-node bin/app.ts' }),
    'bin/app.ts': "import { App } from 'aws-cdk-lib';\nimport { AppStack } from '../lib/stack';\nconst app = new App();\nnew AppStack(app, 'shop-ledger');\n",
    'lib/stack.ts': [
      "import * as path from 'path';",
      "import { Fn, Stack } from 'aws-cdk-lib';",
      "import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';",
      "import * as kinesis from 'aws-cdk-lib/aws-kinesis';",
      "import * as lambda from 'aws-cdk-lib/aws-lambda';",
      "import { DynamoEventSource, KinesisEventSource, S3OnFailureDestination, SnsDlq, SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources';",
      "import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';",
      "import * as s3 from 'aws-cdk-lib/aws-s3';",
      "import * as sns from 'aws-cdk-lib/aws-sns';",
      "import * as sqs from 'aws-cdk-lib/aws-sqs';",
      "import { Construct } from 'constructs';",
      'export class AppStack extends Stack {',
      '  constructor(scope: Construct, id: string) {',
      '    super(scope, id);',
      "    const tally = new NodejsFunction(this, 'Tally', { functionName: 'shop-tally', entry: path.join(__dirname, '..', 'src', 'tally.ts'), runtime: lambda.Runtime.NODEJS_20_X });",
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

const failures = (deployment: Deployment) => deployment.deliveries.filter((delivery) => delivery.by === 'destination').map((delivery) => [delivery.address, delivery.from, delivery.to]);

describe("an event source's onFailure (P264)", () => {
  it('hands what a stream source gives up on to the queue, the topic or the bucket its onFailure names', () => {
    const deployment = stack(
      [
        "    const clicks = new kinesis.Stream(this, 'Clicks', { streamName: 'shop-clicks' });",
        "    const orders = new dynamodb.Table(this, 'Orders', { tableName: 'shop-orders', partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING }, stream: dynamodb.StreamViewType.NEW_IMAGE });",
        "    const failed = sqs.Queue.fromQueueArn(this, 'Failed', Fn.importValue('shop-failed-arn'));",
        "    const alerts = new sns.Topic(this, 'Alerts', { topicName: 'shop-alerts' });",
        "    const archive = new s3.Bucket(this, 'Archive', { bucketName: 'shop-archive' });",
        '    tally.addEventSource(new KinesisEventSource(clicks, { startingPosition: lambda.StartingPosition.LATEST, onFailure: new SqsDlq(failed) }));',
        '    tally.addEventSource(new DynamoEventSource(orders, { startingPosition: lambda.StartingPosition.LATEST, onFailure: new SnsDlq(alerts) }));',
        "    new lambda.EventSourceMapping(this, 'Views', { target: tally, eventSourceArn: 'arn:aws:kinesis:eu-west-1:1:stream/shop-views', startingPosition: lambda.StartingPosition.LATEST, onFailure: new S3OnFailureDestination(archive) });",
      ].join('\n'),
    );
    const clicks = 'shop-ledger/Tally/KinesisEventSource:shop-ledger/Clicks';
    const orders = 'shop-ledger/Tally/DynamoEventSource:shop-ledger/Orders';
    expect(failures(deployment)).toEqual([
      [`${clicks}/onFailure`, { kind: 'outcome', when: 'failure', of: { delivery: clicks } }, { kind: 'queue', name: importedName('export:shop-failed-arn') }],
      [`${orders}/onFailure`, { kind: 'outcome', when: 'failure', of: { delivery: orders } }, { kind: 'topic', name: 'shop-alerts' }],
      ['shop-ledger/Views/onFailure', { kind: 'outcome', when: 'failure', of: { delivery: 'shop-ledger/Views' } }, undefined],
    ]);
    expect(deployment.imports?.map((site) => [site.key, site.kinds])).toEqual([['export:shop-failed-arn', ['queue']]]);
    expect(deployment.rows.find((row) => row.symbol === 'shop-ledger/Views/onFailure')?.message).toContain('a bucket, which nothing is delivered to');
  });

  it('draws the failure of each reading of a mapping of an import with the reading', () => {
    const deployment = stack(
      [
        "    const failed = new sqs.Queue(this, 'Failed', { queueName: 'shop-failed' });",
        "    new lambda.EventSourceMapping(this, 'Clicks', { target: tally, eventSourceArn: Fn.importValue('shop-clicks-arn'), startingPosition: lambda.StartingPosition.LATEST, onFailure: new SqsDlq(failed) });",
      ].join('\n'),
    );
    const mapping = 'shop-ledger/Clicks';
    expect(failures(deployment)).toEqual(
      ['stream', 'table'].map((kind) => [alternativeAddress(`${mapping}/onFailure`, kind), { kind: 'outcome', when: 'failure', of: { delivery: alternativeAddress(mapping, kind) } }, { kind: 'queue', name: 'shop-failed' }]),
    );
    expect(deployment.imports?.[0]?.alternatives?.map((alternative) => alternative.address)).toEqual([
      ...['stream', 'table'].map((kind) => alternativeAddress(mapping, kind)),
      ...['stream', 'table'].map((kind) => alternativeAddress(`${mapping}/onFailure`, kind)),
    ]);
  });
});
