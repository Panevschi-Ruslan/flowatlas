import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { alternativeAddress, importedName, parseConfig, type Deployment } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { cdkReader } from './index.js';

const IMPORTS = [
  "import * as path from 'path';",
  "import { Fn, Stack, type StackProps } from 'aws-cdk-lib';",
  "import * as events from 'aws-cdk-lib/aws-events';",
  "import * as lambda from 'aws-cdk-lib/aws-lambda';",
  "import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';",
  "import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';",
  "import * as sqs from 'aws-cdk-lib/aws-sqs';",
  "import * as ssm from 'aws-cdk-lib/aws-ssm';",
  "import { Construct } from 'constructs';",
  "const fn = (scope: Construct, name: string, environment: Record<string, string> = {}) => new NodejsFunction(scope, name, { functionName: name, entry: path.join(__dirname, '..', 'src', `${name}.ts`), runtime: lambda.Runtime.NODEJS_20_X, environment });",
].join('\n');

/** An app of two stacks: `storage`, whose body is the first, and `worker`, handed the storage stack, whose body is the second. */
const app = (storage: string, worker: string): Deployment => {
  const repoDir = mkdtempSync(join(tmpdir(), 'flowatlas-cdk-parameters-'));
  const files: Record<string, string> = {
    'cdk.json': JSON.stringify({ app: 'npx ts-node bin/app.ts' }),
    'bin/app.ts': [
      "import { App } from 'aws-cdk-lib';",
      "import { StorageStack, WorkerStack } from '../lib/stacks';",
      'const app = new App();',
      "const storage = new StorageStack(app, 'storage');",
      "new WorkerStack(app, 'worker', { storage });",
    ].join('\n'),
    'lib/stacks.ts': [
      IMPORTS,
      'export class StorageStack extends Stack {',
      '  readonly jobs: sqs.Queue;',
      '  constructor(scope: Construct, id: string, props?: StackProps) {',
      '    super(scope, id, props);',
      "    this.jobs = new sqs.Queue(this, 'Jobs', { queueName: 'jobs' });",
      storage,
      '  }',
      '}',
      'export class WorkerStack extends Stack {',
      '  constructor(scope: Construct, id: string, props: StackProps & { storage: StorageStack }) {',
      '    super(scope, id, props);',
      worker,
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

describe('values an app shares between its stacks and with other deployments (P253)', () => {
  it('reads what one stack hands another, exports or writes to a parameter as the value itself, with no import left', () => {
    const deployment = app(
      [
        "    this.exportValue(this.jobs.queueArn, { name: 'jobs-arn' });",
        "    const bus = new events.EventBus(this, 'Bus', { eventBusName: 'shop' });",
        "    new ssm.StringParameter(this, 'BusName', { parameterName: '/shop/bus', stringValue: bus.eventBusName });",
      ].join('\n'),
      [
        "    const again = sqs.Queue.fromQueueArn(this, 'Again', Fn.importValue('jobs-arn'));",
        "    const build = fn(this, 'build', { JOBS: again.queueUrl, BUS: ssm.StringParameter.valueForStringParameter(this, '/shop/bus') });",
        '    build.addEventSource(new SqsEventSource(props.storage.jobs));',
      ].join('\n'),
    );
    const environment = deployment.functions[0]?.environment ?? {};
    expect(environment['JOBS']?.names).toEqual({ kind: 'queue', name: 'jobs' });
    expect(environment['BUS']?.names).toEqual({ kind: 'bus', name: 'shop' });
    expect(deployment.deliveries.map((delivery) => delivery.from)).toEqual([{ kind: 'queue', name: 'jobs' }]);
    expect(deployment.imports ?? []).toEqual([]);
    expect(deployment.exports?.map((value) => [value.keys, value.names])).toEqual([
      [['export:jobs-arn'], { kind: 'queue', name: 'jobs' }],
      [['parameter:/shop/bus'], { kind: 'bus', name: 'shop' }],
    ]);
  });

  it('reads a parameter another deployment writes, by each way the CDK reads one', () => {
    const deployment = app(
      '',
      [
        "    const placed = sqs.Queue.fromQueueArn(this, 'Placed', ssm.StringParameter.valueForStringParameter(this, '/shop/placed'));",
        "    const looked = ssm.StringParameter.fromStringParameterName(this, 'Mode', '/shop/mode');",
        "    const tally = fn(this, 'tally', { MODE: looked.stringValue, LOOKED_UP: ssm.StringParameter.valueFromLookup(this, '/shop/lookup') });",
        '    tally.addEventSource(new SqsEventSource(placed));',
      ].join('\n'),
    );
    const environment = deployment.functions[0]?.environment ?? {};
    expect(environment['MODE']?.imported).toBe('parameter:/shop/mode');
    expect(environment['LOOKED_UP']?.imported).toBe('parameter:/shop/lookup');
    expect(deployment.deliveries.map((delivery) => delivery.from)).toEqual([{ kind: 'queue', name: importedName('parameter:/shop/placed') }]);
  });

  it('reads a mapping of an imported source with a starting position as a stream or a table', () => {
    const deployment = app(
      '',
      [
        "    const tally = fn(this, 'tally');",
        "    new lambda.EventSourceMapping(this, 'Changes', { target: tally, eventSourceArn: ssm.StringParameter.valueForStringParameter(this, '/shop/stream'), startingPosition: lambda.StartingPosition.LATEST });",
        "    new lambda.EventSourceMapping(this, 'Queued', { target: tally, eventSourceArn: Fn.importValue('shop-queue') });",
      ].join('\n'),
    );
    const stand = importedName('parameter:/shop/stream');
    expect(deployment.deliveries.map((delivery) => [delivery.address, delivery.from])).toEqual([
      [alternativeAddress('worker/Changes', 'stream'), { kind: 'changes', of: 'stream', name: stand }],
      [alternativeAddress('worker/Changes', 'table'), { kind: 'changes', of: 'table', name: stand }],
      ['worker/Queued', { kind: 'queue', name: importedName('export:shop-queue') }],
    ]);
  });
});
