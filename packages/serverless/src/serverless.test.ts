import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { generatedName, parseConfig, type Deployment } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { readServiceYaml, ServiceFileUnreadable } from './document.js';
import { serverlessReader, serviceFiles } from './index.js';
import { HOLE, Unread, Variables } from './variables.js';

/** A repository of the files given, read as the Serverless Framework reader reads it. */
const repository = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'flowatlas-serverless-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
};

const read = (files: Record<string, string>, options?: Record<string, string>): Deployment => {
  const repoDir = repository(files);
  return serverlessReader.read({
    repoDir,
    config: parseConfig({}),
    service: { name: 'svc', repo: repoDir, type: 'lambda', ...(options === undefined ? {} : { infra: { vars: [], options } }) },
  });
};

const reasons = (deployment: Deployment): string[] => deployment.rows.map((row) => row.reason);

describe('a service file as a document', () => {
  it('turns the short tags into the long form, and places every key and list item', () => {
    const document = readServiceYaml('a: !Ref Queue\nb: !GetAtt Table.StreamArn\nc:\n  - !Sub "${AWS::Region}"\n  - !Join [":", [x, y]]\n');
    expect(document.value).toEqual({
      a: { Ref: 'Queue' },
      b: { 'Fn::GetAtt': ['Table', 'StreamArn'] },
      c: [{ 'Fn::Sub': '${AWS::Region}' }, { 'Fn::Join': [':', ['x', 'y']] }],
    });
    expect(document.at(['b'])?.line).toBe(2);
    expect(document.at(['c', 1])?.line).toBe(5);
  });

  it('reads a merge key, and refuses a file that is not YAML with its line', () => {
    expect(readServiceYaml('base: &base\n  runtime: nodejs20.x\nfn:\n  <<: *base\n  handler: h.main\n').value).toEqual({
      base: { runtime: 'nodejs20.x' },
      fn: { runtime: 'nodejs20.x', handler: 'h.main' },
    });
    expect(() => readServiceYaml('a: [1, 2\nb: 3\n')).toThrow(ServiceFileUnreadable);
  });
});

describe('variables, resolved where the files settle them', () => {
  const resolve = (document: unknown, options: Record<string, string> = {}, dir = tmpdir()) =>
    new Variables({ document, dir, options, loaded: new Set() });

  it('reads self, options with their fallbacks, the stage and parameters, innermost first', () => {
    const document = {
      service: 'orders',
      provider: { stage: "${opt:stage, 'dev'}", region: 'eu-west-1' },
      params: { prod: { rate: 'rate(1 day)' }, default: { rate: 'rate(1 hour)' } },
      custom: { prefix: '${self:service}-${sls:stage}', name: '${self:custom.${opt:which, "prefix"}}', rate: '${param:rate}', region: '${aws:region}' },
    };
    const dev = resolve(document);
    expect(dev.at(['custom'])).toEqual({ prefix: 'orders-dev', name: 'orders-dev', rate: 'rate(1 hour)', region: 'eu-west-1' });
    expect(dev.stage).toEqual({ value: 'dev', from: 'file' });
    const prod = resolve(document, { stage: 'prod' });
    expect(prod.at(['custom', 'prefix'])).toBe('orders-prod');
    expect(prod.at(['custom', 'rate'])).toBe('rate(1 day)');
    expect(prod.stage.from).toBe('option');
    expect(resolve({ service: 'x' }).stage).toEqual({ value: 'dev', from: 'default' });
  });

  it('reads a file a variable names, and a .env file where the service loads one', () => {
    const dir = repository({ 'config/dev.yml': 'table: orders-table\n', '.env': 'BUCKET=orders-bucket\n' });
    const variables = resolve({ useDotenv: true, custom: { table: '${file(./config/${sls:stage}.yml):table}', bucket: '${env:BUCKET}' } }, {}, dir);
    expect(variables.at(['custom'])).toEqual({ table: 'orders-table', bucket: 'orders-bucket' });
  });

  it('never reads what the account holds, and keeps the rest of an ARN around it', () => {
    const variables = resolve({ a: '${ssm:/orders/name}', b: 'arn:aws:sqs:eu-west-1:${aws:accountId}:orders', c: '${opt:stage}', d: '${AWS::Region}' });
    const a = variables.at(['a']) as Unread;
    expect(a).toBeInstanceOf(Unread);
    expect(a.variable).toBe('ssm:/orders/name');
    expect((variables.at(['b']) as Unread).partial).toBe(`arn:aws:sqs:eu-west-1:${HOLE}:orders`);
    expect((variables.at(['c']) as Unread).text).toMatch(/option --stage/);
    // A CloudFormation substitution is the template's, not the framework's.
    expect(variables.at(['d'])).toBe('${AWS::Region}');
  });

  it('says a value that refers to itself rather than looping', () => {
    expect(resolve({ a: '${self:b}', b: '${self:a}' }).at(['a'])).toBeInstanceOf(Unread);
  });
});

const SERVICE = `
service: orders
provider:
  name: aws
  runtime: nodejs20.x
  environment:
    QUEUE_URL: !Ref Queue
functions:
  place-order:
    handler: src/place.handler
    url: true
    events:
      - http: POST orders
      - httpApi: '*'
      - websocket: $connect
      - sqs:
          arn: !GetAtt Queue.Arn
          filterPatterns: [{ body: { kind: [order] } }]
      - sns: orders-placed
      - stream: !GetAtt Table.StreamArn
      - schedule:
          name: nightly
          rate: [rate(1 hour), cron(0 2 * * ? *)]
      - eventBridge:
          pattern: { source: [shop], detail-type: [OrderPlaced] }
      - s3: { bucket: uploads, event: 's3:ObjectCreated:*', rules: [{ prefix: in/ }, { suffix: .csv }] }
      - cognitoUserPool: { pool: shoppers, trigger: PreSignUp }
      - alb: { listenerArn: arn, priority: 1 }
    destinations:
      onFailure: notify
  notify:
    handler: src/notify.handler
resources:
  Resources:
    Queue:
      Type: AWS::SQS::Queue
    Table:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: orders-\${sls:stage}
        StreamSpecification: { StreamViewType: NEW_IMAGE }
`;

describe('a service read into a deployment (P57)', () => {
  const deployment = read({ 'serverless.yml': SERVICE });

  it('names each function as the framework does, and lands its handler in the service directory', () => {
    expect(deployment.functions.map((fn) => fn.name)).toEqual(['orders-dev-place-order', 'orders-dev-notify']);
    expect(deployment.functions[0]?.handler).toMatchObject({ module: 'src/place', export: 'handler', directory: '.' });
    expect(deployment.functions[0]?.environment?.['QUEUE_URL']).toMatchObject({ names: { kind: 'queue', name: generatedName('resources.Resources.Queue') } });
  });

  it('draws the REST, HTTP and function URL routes as Terraform keys them', () => {
    expect(deployment.routes.map((route) => [route.method, route.path, route.api, route.meta?.['key']])).toEqual([
      ['POST', '/orders', 'dev-orders', 'POST:/orders'],
      ['ALL', '/:param', 'dev-orders', 'ALL:/:param'],
      ['ALL', '/*', undefined, 'ALL:/*@orders-dev-place-order'],
    ]);
  });

  it('draws every event a function is run by as the delivery Terraform would hold', () => {
    expect(deployment.deliveries.map((delivery) => [delivery.by, delivery.from])).toEqual([
      ['route', { kind: 'connection', api: 'dev-orders-websockets', route: '$connect' }],
      ['mapping', { kind: 'queue', name: generatedName('resources.Resources.Queue') }],
      ['subscription', { kind: 'topic', name: 'orders-placed' }],
      ['mapping', { kind: 'changes', of: 'table', name: 'orders-dev' }],
      ['schedule', { kind: 'schedule', expression: 'rate(1 hour)' }],
      ['schedule', { kind: 'schedule', expression: 'cron(0 2 * * ? *)' }],
      ['rule', { kind: 'bus', name: 'default', pattern: { fields: { source: [{ equals: 'shop' }], 'detail-type': [{ equals: 'OrderPlaced' }] } } }],
      ['notification', { kind: 'bucket', name: 'uploads', events: ['s3:ObjectCreated:*'], prefix: 'in/', suffix: '.csv' }],
      ['trigger', { kind: 'trigger', service: 'cognito', key: 'cognito/shoppers/pre_sign_up' }],
      ['destination', { kind: 'outcome', when: 'failure', of: { function: 0 } }],
    ]);
    expect(deployment.deliveries[1]?.meta).toMatchObject({ unmatched: { filter: ['{"body":{"kind":["order"]}}'] } });
    expect(deployment.deliveries.at(-1)?.to).toEqual({ kind: 'function', function: 1 });
    expect(deployment.streams).toEqual([expect.objectContaining({ of: 'table', name: 'orders-dev' })]);
  });

  it('says what it does not read, and the name it stands in for', () => {
    expect(reasons(deployment)).toEqual(expect.arrayContaining(['invoker-not-read', 'deployed-name-generated']));
  });

  it('reads the step-functions plugin, filling each reference with what it names', () => {
    const machines = read({
      'serverless.yml': [
        'service: shop',
        'provider: { name: aws }',
        'functions:',
        '  charge: { handler: src/charge.handler }',
        'stepFunctions:',
        '  stateMachines:',
        '    pay:',
        '      name: shop-pay',
        '      events: [{ schedule: rate(1 day) }]',
        '      definition:',
        '        StartAt: Charge',
        '        States:',
        '          Charge: { Type: Task, Resource: !GetAtt charge.Arn, End: true }',
      ].join('\n'),
    });
    const [workflow] = machines.workflows;
    expect(workflow?.name).toBe('shop-pay');
    expect(workflow?.definition?.kind).toBe('value');
    const state = ((workflow?.definition as { value: { States: Record<string, { Resource: string }> } }).value.States['Charge']?.Resource ?? '').slice(2, -1);
    expect(workflow?.fill(state)).toBe('arn:aws:lambda:::function:shop-dev-charge');
    expect(workflow?.definition?.kind === 'value' ? workflow.definition.at(['States', 'Charge'])?.line : undefined).toBe(13);
    expect(machines.deliveries).toEqual([expect.objectContaining({ by: 'schedule', to: { kind: 'workflow', name: 'shop-pay' } })]);
  });

  it('reads a name from the options a deployment is run with, and rows one the account holds', () => {
    const named = read({ 'serverless.yml': 'service: shop\nprovider: { name: aws, stage: "${opt:stage}" }\nfunctions:\n  a: { handler: a.main }\n  b: { name: "${ssm:/b}", handler: b.main }\n' }, { stage: 'prod' });
    expect(named.functions.map((fn) => fn.name)).toEqual(['shop-prod-a', undefined]);
    expect(named.rows).toEqual([expect.objectContaining({ reason: 'function-name-unread', meta: { variable: 'ssm:/b' } })]);
    const unset = read({ 'serverless.yml': 'service: shop\nprovider: { name: aws, stage: "${opt:stage}" }\nfunctions:\n  a: { handler: a.main }\n' });
    expect(unset.functions[0]?.name).toBeUndefined();
    expect(unset.rows[0]?.hint).toMatch(/services\[\]\.infra\.options/);
  });

  it('reads nothing of a file that is not YAML, or of another provider, and says so', () => {
    expect(reasons(read({ 'serverless.yml': 'service: [x\n' }))).toEqual(['infra-file-unparsed']);
    expect(reasons(read({ 'serverless.yml': 'service: x\nprovider: { name: azure }\n' }))).toEqual(['deployment-unread']);
  });

  it('declares nothing for a service file that deploys elsewhere, kept only for its variables', () => {
    expect(serverlessReader.declares(repository({ 'serverless.yml': 'service: pay\nprovider:\n  name: example\n' }))).toBe(false);
    expect(serverlessReader.declares(repository({ 'serverless.yml': 'service: pay\nprovider:\n  name: aws\n' }))).toBe(true);
    expect(serverlessReader.declares(repository({ 'serverless.ts': "module.exports = { provider: { name: 'aws' } };\n" }))).toBe(true);
  });

  it('finds a service per directory, and skips what is built or installed', () => {
    const dir = repository({ 'services/a/serverless.yml': 'x: 1', 'services/b/serverless.ts': 'x', 'node_modules/c/serverless.yml': 'x', '.serverless/serverless.yml': 'x' });
    expect(serviceFiles(dir)).toEqual(['services/a/serverless.yml', 'services/b/serverless.ts']);
  });
});

describe('what P246 added to the CloudFormation a service file holds', () => {
  it("names a function's URL by the function, as the framework declares it (P54)", () => {
    const deployment = read({
      'serverless.yml': [
        'service: shop',
        'provider: { name: aws }',
        'functions:',
        '  receipt: { handler: src/receipt.handler, url: true }',
        '  kiosk:',
        '    handler: src/kiosk.handler',
        '    environment: { RECEIPT_URL: !GetAtt ReceiptLambdaFunctionUrl.FunctionUrl }',
      ].join('\n'),
    });
    expect(deployment.functions[1]?.environment?.['RECEIPT_URL']?.names).toEqual({ kind: 'url', name: 'shop-dev-receipt' });
  });

  it('reads a schedule of the scheduler, where a function hands its runs on, a user pool and a URL written as resources', () => {
    const deployment = read({
      'serverless.yml': [
        'service: shop',
        'provider: { name: aws }',
        'functions:',
        '  tick: { handler: src/tick.handler }',
        'resources:',
        '  Resources:',
        '    Nightly:',
        '      Type: AWS::Scheduler::Schedule',
        '      Properties: { Name: shop-nightly, ScheduleExpression: rate(1 day), State: DISABLED, Target: { Arn: !GetAtt TickLambdaFunction.Arn } }',
        '    Results:',
        '      Type: AWS::Lambda::EventInvokeConfig',
        '      Properties: { FunctionName: !Ref TickLambdaFunction, DestinationConfig: { OnFailure: { Destination: !GetAtt Failed.Arn } } }',
        '    Failed: { Type: AWS::SQS::Queue, Properties: { QueueName: shop-failed } }',
        '    Pool:',
        '      Type: AWS::Cognito::UserPool',
        '      Properties: { LambdaConfig: { PostConfirmation: !GetAtt TickLambdaFunction.Arn, CustomEmailSender: { LambdaArn: !GetAtt TickLambdaFunction.Arn } } }',
        '    TickUrl: { Type: AWS::Lambda::Url, Properties: { TargetFunctionArn: !GetAtt TickLambdaFunction.Arn, AuthType: NONE } }',
      ].join('\n'),
    });
    const pool = generatedName('resources.Resources.Pool');
    expect(deployment.deliveries.map((delivery) => [delivery.by, delivery.from, delivery.to, delivery.meta?.['disabled'] ?? false])).toEqual([
      ['schedule', { kind: 'schedule', expression: 'rate(1 day)' }, { kind: 'function', function: 0 }, true],
      ['destination', { kind: 'outcome', when: 'failure', of: { function: 0 } }, { kind: 'queue', name: 'shop-failed' }, false],
      ['trigger', { kind: 'trigger', service: 'cognito', key: `cognito/${pool}/post_confirmation` }, { kind: 'function', function: 0 }, false],
      ['trigger', { kind: 'trigger', service: 'cognito', key: `cognito/${pool}/custom_email_sender` }, { kind: 'function', function: 0 }, false],
    ]);
    expect(deployment.routes).toEqual([expect.objectContaining({ method: 'ALL', path: '/*', target: { function: 0 } })]);
    expect(reasons(deployment)).toContain('deployed-name-generated');
  });

  it('says which variable a substitution waits on, not only that part of it is unread', () => {
    const deployment = read({
      'serverless.yml': [
        'service: shop',
        'provider: { name: aws }',
        'functions:',
        '  a:',
        '    handler: src/a.handler',
        '    environment: { QUEUE: !Sub ["${Base}-orders", { Base: "${ssm:/shop/base}" }] }',
      ].join('\n'),
    });
    expect(deployment.functions[0]?.environment?.['QUEUE']?.unread).toMatchObject({ variable: 'ssm:/shop/base' });
  });

  it('reads an API Gateway address in its region and at its stage as its own API, and no address of one as a queue (P268)', () => {
    const service = (events: string): string =>
      [
        'service: shop',
        'provider: { name: aws, stage: dev, region: eu-west-1 }',
        'functions:',
        '  ledger:',
        '    handler: src/ledger.handler',
        `    events: [${events}]`,
        '  caller:',
        '    handler: src/caller.handler',
        '    environment:',
        '      OWN: https://a1b2c3d4e5.execute-api.eu-west-1.amazonaws.com/dev/ledger',
        '      ELSEWHERE: https://a1b2c3d4e5.execute-api.us-east-1.amazonaws.com/dev/ledger',
        '      OTHER_STAGE: https://a1b2c3d4e5.execute-api.eu-west-1.amazonaws.com/prod/ledger',
      ].join('\n');
    const rest = read({ 'serverless.yml': service('{ http: { path: ledger, method: POST } }') }).functions[1]?.environment ?? {};
    expect(rest['OWN']).toMatchObject({ names: { kind: 'api', name: 'dev-shop' }, path: '/ledger' });
    expect(rest['ELSEWHERE']).toEqual({ written: expect.any(String), text: 'https://a1b2c3d4e5.execute-api.us-east-1.amazonaws.com/dev/ledger' });
    expect(rest['OTHER_STAGE']?.names).toBeUndefined();
    // An HTTP API's default stage writes none: the stage is part of the path.
    const http = read({ 'serverless.yml': service('{ httpApi: { path: /dev/ledger, method: POST } }') }).functions[1]?.environment ?? {};
    expect(http['OTHER_STAGE']).toMatchObject({ names: { kind: 'api', name: 'dev-shop' }, path: '/prod/ledger' });
  });
});
