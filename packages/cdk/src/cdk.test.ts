import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { generatedName, parseConfig, type Deployment } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { cdkModuleOf } from './modules.js';
import { cdkReader } from './index.js';
import { runtimeOf } from './statics.js';

/** An app of the files given, `cdk.json` naming `bin/app.ts` unless the files hold their own. */
const read = (files: Record<string, string>, options?: Record<string, string>): Deployment => {
  const repoDir = mkdtempSync(join(tmpdir(), 'flowatlas-cdk-'));
  const all = { 'cdk.json': JSON.stringify({ app: 'npx ts-node bin/app.ts', context: { stage: 'dev' } }), ...files };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(repoDir, path)), { recursive: true });
    writeFileSync(join(repoDir, path), text);
  }
  return cdkReader.read({
    repoDir,
    config: parseConfig({}),
    service: { name: 'app', repo: repoDir, type: 'lambda', ...(options === undefined ? {} : { infra: { vars: [], options } }) },
  });
};

/** A stack of one constructor body, made by the app, with the imports every test uses. */
const stack = (body: string, extra: Record<string, string> = {}, options?: Record<string, string>): Deployment =>
  read(
    {
      'bin/app.ts': "import { App } from 'aws-cdk-lib';\nimport { AppStack } from '../lib/stack';\nconst app = new App();\nnew AppStack(app, 'App', { stage: app.node.tryGetContext('stage') });\n",
      'lib/stack.ts': [
        "import * as path from 'path';",
        "import * as cdk from 'aws-cdk-lib';",
        "import { aws_lambda as lambda, aws_sqs as sqs, aws_events as events, aws_events_targets as targets } from 'aws-cdk-lib';",
        "import * as apigw from 'aws-cdk-lib/aws-apigateway';",
        "import * as sfn from 'aws-cdk-lib/aws-stepfunctions';",
        "import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';",
        "import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';",
        "import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';",
        "import { Construct } from 'constructs';",
        'export class AppStack extends cdk.Stack {',
        '  constructor(scope: Construct, id: string, props: { stage: string }) {',
        '    super(scope, id);',
        body,
        '  }',
        '}',
      ].join('\n'),
      ...extra,
    },
    options,
  );

const fn = (id: string, extra = ''): string =>
  `new lambda.Function(this, '${id}', { runtime: lambda.Runtime.NODEJS_20_X, code: lambda.Code.fromAsset(path.join(__dirname, '..', 'src')), handler: '${id.toLowerCase()}.handler'${extra} })`;

describe('which module of the CDK an import names', () => {
  it('reads every spelling the CDK has had', () => {
    expect(cdkModuleOf('aws-cdk-lib')).toBe('core');
    expect(cdkModuleOf('aws-cdk-lib/aws-lambda')).toBe('aws-lambda');
    expect(cdkModuleOf('@aws-cdk/aws-sqs')).toBe('aws-sqs');
    expect(cdkModuleOf('@aws-cdk/aws-apigatewayv2-alpha')).toBe('aws-apigatewayv2');
    expect(cdkModuleOf('constructs')).toBe('constructs');
    expect(cdkModuleOf('./lib/stack')).toBeUndefined();
  });

  it('spells a runtime as the template does', () => {
    expect(runtimeOf('NODEJS_20_X')).toBe('nodejs20.x');
    expect(runtimeOf('PYTHON_3_12')).toBe('python3.12');
  });
});

describe('an app, followed from its entry (P57)', () => {
  it('names functions from the context, an option, and a helper and a constant in another file', () => {
    const files = {
      'bin/app.ts': "import * as cdk from 'aws-cdk-lib';\nimport { Shop } from '../lib/shop';\nconst app = new cdk.App();\nnew Shop(app, 'Shop', { stage: app.node.tryGetContext('stage') ?? 'test' });\n",
      'lib/names.ts': "export const PREFIX = 'shop';\nexport const nameOf = (stage: string, what: string): string => `${PREFIX}-${stage}-${what}`;\n",
      'lib/shop.ts': [
        "import { Stack } from 'aws-cdk-lib';",
        "import * as lambda from 'aws-cdk-lib/aws-lambda';",
        "import { nameOf } from './names';",
        'export class Shop extends Stack {',
        '  constructor(scope: any, id: string, { stage }: { stage: string }) {',
        '    super(scope, id);',
        "    new lambda.Function(this, 'Place', { functionName: nameOf(stage, 'place'), handler: 'place.handler', code: lambda.Code.fromAsset('src') });",
        '  }',
        '}',
      ].join('\n'),
    };
    expect(read(files).functions.map((f) => [f.name, f.address, f.line])).toEqual([['shop-dev-place', 'Shop/Place', 7]]);
    expect(read(files, { stage: 'prod' }).functions.map((f) => f.name)).toEqual(['shop-prod-place']);
  });

  it('lands a handler on the source its asset is, and a NodejsFunction on its entry or its default', () => {
    const deployment = stack(
      [
        `    ${fn('Place')};`,
        "    new NodejsFunction(this, 'Notify', { entry: path.join(__dirname, '..', 'src', 'notify.ts') });",
        "    new NodejsFunction(this, 'Audit');",
      ].join('\n'),
      { 'lib/stack.Audit.ts': 'export const handler = async () => {};\n' },
    );
    expect(deployment.functions.map((f) => f.handler)).toEqual([
      expect.objectContaining({ module: 'place', export: 'handler', directory: 'src' }),
      expect.objectContaining({ module: 'notify', export: 'handler', directory: 'src' }),
      expect.objectContaining({ module: 'stack.Audit', export: 'handler', directory: 'lib' }),
    ]);
  });

  it('names what has no name of its own by its path, so every reference to it agrees', () => {
    const deployment = stack(
      [
        "    const queue = new sqs.Queue(this, 'Inbox');",
        `    const sender = ${fn('Sender', ', environment: { INBOX_URL: queue.queueUrl }')};`,
        `    const reader = ${fn('Reader')};`,
        '    reader.addEventSource(new SqsEventSource(queue, { batchSize: 5 }));',
      ].join('\n'),
    );
    const inbox = generatedName('App/Inbox');
    expect(deployment.functions.map((f) => [f.name, f.meta?.['nameGenerated']])).toEqual([
      [undefined, true],
      [undefined, true],
    ]);
    expect(deployment.functions[0]?.environment?.['INBOX_URL']).toMatchObject({ names: { kind: 'queue', name: inbox } });
    expect(deployment.deliveries).toEqual([expect.objectContaining({ by: 'mapping', from: { kind: 'queue', name: inbox }, to: { kind: 'function', function: 1 } })]);
    expect(deployment.rows.filter((row) => row.reason === 'deployed-name-generated').map((row) => row.symbol).sort()).toEqual(['App/Inbox', 'App/Reader', 'App/Sender']);
  });

  it('takes a loop over a settled list once per element, and one over an unread list once, with a row', () => {
    const deployment = stack(
      [
        "    for (const kind of ['a', 'b']) new sqs.Queue(this, `Q-${kind}`, { queueName: `shop-${kind}` });",
        "    for (const name of cdk.Fn.split(',', 'x')) new sqs.Queue(this, `R-${name}`, { queueName: `shop-${name}` });",
        "    ['c', 'd'].forEach((kind) => new sqs.Queue(this, `S-${kind}`, { queueName: `shop-${kind}` }));",
        "    const dead = new sqs.Queue(this, 'Dead', { queueName: 'shop-dead' });",
        "    new sqs.Queue(this, 'Main', { queueName: 'shop-main', deadLetterQueue: { queue: dead, maxReceiveCount: 2 } });",
      ].join('\n'),
    );
    expect(deployment.deliveries).toEqual([
      expect.objectContaining({ by: 'redrive', from: { kind: 'queue', name: 'shop-main' }, to: { kind: 'queue', name: 'shop-dead' }, meta: { maxReceiveCount: 2 } }),
    ]);
    expect(deployment.rows.map((row) => row.reason)).toContain('construct-repeated-unread');
  });

  it('decides a settled condition, and draws an unsettled one heuristic', () => {
    const deployment = stack(
      [
        `    const target = ${fn('Target', ", functionName: 'shop-target'")};`,
        "    if (props.stage === 'prod') new events.Rule(this, 'Prod', { schedule: events.Schedule.rate(cdk.Duration.hours(1)), targets: [new targets.LambdaFunction(target)] });",
        "    if (process.env.EXTRA === 'yes') new events.Rule(this, 'Extra', { ruleName: 'shop-extra', schedule: events.Schedule.cron({ minute: '0', hour: '2' }), targets: [new targets.LambdaFunction(target)] });",
      ].join('\n'),
    );
    expect(deployment.deliveries).toEqual([
      expect.objectContaining({ name: 'shop-extra', from: { kind: 'schedule', expression: 'cron(0 2 * * ? *)' }, meta: expect.objectContaining({ conditional: "process.env.EXTRA === 'yes'" }) }),
    ]);
    expect(deployment.rows.map((row) => row.reason)).toContain('construct-conditional');
  });

  it('reads a REST API by its resource tree, and a LambdaRestApi as a proxy', () => {
    const deployment = stack(
      [
        `    const place = ${fn('Place', ", functionName: 'shop-place'")};`,
        "    const api = new apigw.RestApi(this, 'Api');",
        "    const orders = api.root.addResource('orders');",
        '    orders.addMethod(\'POST\', new apigw.LambdaIntegration(place), { authorizationType: apigw.AuthorizationType.IAM });',
        "    orders.addResource('{id}').addMethod('GET', new apigw.LambdaIntegration(place));",
        "    new apigw.LambdaRestApi(this, 'Proxy', { restApiName: 'shop-proxy', handler: place });",
      ].join('\n'),
    );
    expect(deployment.routes.map((route) => [route.method, route.path, route.api, route.target, route.guards?.map((guard) => guard.label)])).toEqual([
      ['POST', '/orders', 'Api', { function: 0 }, ['IAM']],
      ['GET', '/orders/:param', 'Api', { function: 0 }, undefined],
      ['ALL', '/', 'shop-proxy', { function: 0 }, undefined],
      ['ALL', '/:param', 'shop-proxy', { function: 0 }, undefined],
    ]);
  });

  it('writes a chain out as the States Language, its references filled', () => {
    const deployment = stack(
      [
        `    const charge = ${fn('Charge', ", functionName: 'shop-charge'")};`,
        "    const queue = new sqs.Queue(this, 'Reminders', { queueName: 'shop-reminders' });",
        "    const paid = new sfn.Choice(this, 'Paid?').when(sfn.Condition.booleanEquals('$.paid', true), new sfn.Succeed(this, 'Done')).otherwise(new tasks.SqsSendMessage(this, 'Remind', { queue, messageBody: sfn.TaskInput.fromJsonPathAt('$') }));",
        "    new sfn.StateMachine(this, 'Pay', { stateMachineName: 'shop-pay', definitionBody: sfn.DefinitionBody.fromChainable(new tasks.LambdaInvoke(this, 'Charge', { lambdaFunction: charge }).next(paid)) });",
      ].join('\n'),
    );
    const [workflow] = deployment.workflows;
    const definition = workflow?.definition;
    expect(workflow?.name).toBe('shop-pay');
    if (definition?.kind !== 'value') throw new Error('no definition');
    const value = definition.value as { StartAt: string; States: Record<string, Record<string, unknown>> };
    expect(value.StartAt).toBe('Charge');
    expect(Object.keys(value.States)).toEqual(['Charge', 'Paid?', 'Done', 'Remind']);
    expect(value.States['Paid?']).toMatchObject({ Type: 'Choice', Choices: [{ Variable: '$.paid', BooleanEquals: true, Next: 'Done' }], Default: 'Remind' });
    const placeholder = String((value.States['Charge']?.['Parameters'] as Record<string, unknown>)['FunctionName']).slice(2, -1);
    expect(workflow?.fill(placeholder)).toBe('arn:aws:lambda:::function:shop-charge');
    const queueUrl = String((value.States['Remind']?.['Parameters'] as Record<string, unknown>)['QueueUrl']).slice(2, -1);
    expect(workflow?.fill(queueUrl)).toBe('arn:aws:sqs:::shop-reminders');
  });

  it('targets a function looked up by its name, for the linker to join wherever it is deployed', () => {
    const deployment = stack(
      [
        "    const billing = lambda.Function.fromFunctionName(this, 'Billing', 'shop-billing');",
        "    new events.Rule(this, 'Joined', { eventPattern: { source: ['shop'], detailType: ['Joined'] }, targets: [new targets.LambdaFunction(billing)] });",
      ].join('\n'),
    );
    expect(deployment.functions).toEqual([]);
    expect(deployment.deliveries).toEqual([
      expect.objectContaining({ by: 'rule', from: expect.objectContaining({ kind: 'bus', name: 'default' }), to: { kind: 'function', name: 'shop-billing' } }),
    ]);
  });

  it('reads every stack on its own where the app is not TypeScript, and says what it never made', () => {
    const alone = read({
      'cdk.json': JSON.stringify({ app: 'python3 app.py' }),
      'lib/stack.ts': "import * as cdk from 'aws-cdk-lib';\nimport * as sqs from 'aws-cdk-lib/aws-sqs';\nexport class Q extends cdk.Stack {\n  constructor(scope: any, id: string) {\n    super(scope, id);\n    new sqs.Queue(this, 'Q', { queueName: 'q' });\n  }\n}\n",
    });
    expect(alone.rows.map((row) => row.reason)).toContain('deployment-app-unread');
    const unreached = stack("    new sqs.Queue(this, 'Q', { queueName: 'q' });", {
      'lib/other.ts': "import * as cdk from 'aws-cdk-lib';\nexport class Other extends cdk.Stack {}\n",
    });
    expect(unreached.rows).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'construct-unreached', symbol: 'Other' })]));
  });
});
