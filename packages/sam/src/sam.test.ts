import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { generatedName, parseConfig, type Deployment } from '@flowatlas/core';
import { Unread } from '@flowatlas/serverless';
import { describe, expect, it } from 'vitest';
import { deployConfigOf, parameterOverrides } from './config.js';
import { cloudFormationFiles, cloudFormationReader, samReader, templateFiles } from './index.js';
import { expandLoops, Resolver } from './intrinsics.js';
import { readToml, TomlUnreadable } from './toml.js';

/** A repository of the files given. */
const repository = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'flowatlas-sam-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
};

const read = (files: Record<string, string>, options?: Record<string, string>): Deployment => {
  const repoDir = repository(files);
  return samReader.read({
    repoDir,
    config: parseConfig({}),
    service: { name: 'svc', repo: repoDir, type: 'lambda', ...(options === undefined ? {} : { infra: { vars: [], options } }) },
  });
};

const reasons = (deployment: Deployment): string[] => deployment.rows.map((row) => row.reason);

/** A template of the transform, its resources indented under `Resources:`. */
const template = (resources: string, head = ''): string =>
  `Transform: AWS::Serverless-2016-10-31\n${head}Resources:\n${resources.replace(/^/gm, '  ')}\n`;

describe('samconfig.toml', () => {
  it('reads tables, dotted names, strings, numbers, arrays over lines and inline tables', () => {
    const value = readToml(
      [
        'version = 0.1',
        '# a comment',
        '[default.deploy.parameters]',
        'stack_name = "shop-dev" # trailing',
        "region = 'eu-west-1'",
        'confirm_changeset = true',
        'tags = ["a", "b",',
        '  "c"]',
        'point = { x = 1, y = "two" }',
        '[[prod.list]]',
        'a = 1',
      ].join('\n'),
    );
    expect(value).toEqual({
      version: 0.1,
      default: { deploy: { parameters: { stack_name: 'shop-dev', region: 'eu-west-1', confirm_changeset: true, tags: ['a', 'b', 'c'], point: { x: 1, y: 'two' } } } },
      prod: { list: [{ a: 1 }] },
    });
    expect(() => readToml('a = \n')).toThrow(TomlUnreadable);
  });

  it('splits parameter overrides where the CLI does, quoted or not, as text or a list', () => {
    expect(parameterOverrides('Stage="prod" Prefix=shop Name=\'a b\' Empty=')).toEqual({ Stage: 'prod', Prefix: 'shop', Name: 'a b', Empty: '' });
    expect(parameterOverrides(['Stage=prod', 'Rate="rate(1 day)"'])).toEqual({ Stage: 'prod', Rate: 'rate(1 day)' });
  });

  it("takes the environment the options name, deploy over global, and the options' own parameters over the file's", () => {
    const repoDir = repository({
      'samconfig.toml': [
        '[default.deploy.parameters]',
        'stack_name = "shop-dev"',
        'parameter_overrides = "Stage=dev"',
        '[prod.global.parameters]',
        'stack_name = "shop-global"',
        'template_file = "infra/template.yaml"',
        '[prod.deploy.parameters]',
        'stack_name = "shop-prod"',
        'parameter_overrides = "Stage=prod Prefix=shop"',
      ].join('\n'),
    });
    expect(deployConfigOf(repoDir, '.', {})).toMatchObject({ stackName: 'shop-dev', parameters: { Stage: 'dev' } });
    expect(deployConfigOf(repoDir, '.', { config_env: 'prod', Prefix: 'store' })).toMatchObject({
      stackName: 'shop-prod',
      template: 'infra/template.yaml',
      parameters: { Stage: 'prod', Prefix: 'store' },
      from: { Stage: 'file', Prefix: 'option' },
    });
  });
});

describe('what a template settles before its resources', () => {
  const resolver = (document: Record<string, unknown>, given: Record<string, string> = {}, pseudo: Record<string, string> = {}) =>
    new Resolver({ document, given: Object.fromEntries(Object.entries(given).map(([key, value]) => [key, { value, from: 'option' as const }])), pseudo, configFile: 'samconfig.toml' });

  const document = {
    Parameters: { Stage: { Type: 'String' }, Prefix: { Type: 'String', Default: 'shop' }, Zones: { Type: 'CommaDelimitedList', Default: 'a, b' }, Owner: { Type: 'String' } },
    Mappings: { Rates: { prod: { Audit: 'rate(1 hour)' } } },
    Conditions: {
      IsProd: { 'Fn::Equals': [{ Ref: 'Stage' }, 'prod'] },
      Owned: { 'Fn::Equals': [{ Ref: 'Owner' }, 'me'] },
      ProdOrOwned: { 'Fn::Or': [{ Condition: 'IsProd' }, { Condition: 'Owned' }] },
      InIreland: { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'eu-west-1'] },
    },
  };

  it('gives a parameter its value from outside, else its Default, else says it has none', () => {
    const at = resolver(document, { Stage: 'prod' });
    expect(at.resolve({ Ref: 'Stage' })).toBe('prod');
    expect(at.resolve({ Ref: 'Prefix' })).toBe('shop');
    expect(at.resolve({ Ref: 'Zones' })).toEqual(['a', 'b']);
    const owner = at.resolve({ Ref: 'Owner' });
    expect(owner).toBeInstanceOf(Unread);
    expect((owner as Unread).variable).toBe('Owner');
    expect(at.resolve({ Ref: 'Queue' })).toEqual({ Ref: 'Queue' });
  });

  it('writes parameters into Fn::Sub, and carries one with no value as a variable of it', () => {
    const at = resolver(document, { Stage: 'prod' });
    expect(at.resolve({ 'Fn::Sub': '${Prefix}-${Stage}-orders' })).toBe('shop-prod-orders');
    expect(at.resolve({ 'Fn::Sub': '${Prefix}-${Queue.Arn}' })).toEqual({ 'Fn::Sub': 'shop-${Queue.Arn}' });
    const unread = at.resolve({ 'Fn::Sub': '${Owner}-x' }) as { 'Fn::Sub': [string, Record<string, unknown>] };
    expect(unread['Fn::Sub'][0]).toBe('${Owner}-x');
    expect(unread['Fn::Sub'][1]['Owner']).toBeInstanceOf(Unread);
  });

  it('decides conditions three ways, the pseudo parameters included, and picks a branch only where one is decided', () => {
    const at = resolver(document, { Stage: 'prod' }, { 'AWS::Region': 'eu-west-1' });
    expect(at.condition('IsProd')).toBe(true);
    expect(at.condition('Owned')).toBeInstanceOf(Unread);
    expect(at.condition('ProdOrOwned')).toBe(true);
    expect(at.condition('InIreland')).toBe(true);
    expect(at.resolve({ 'Fn::If': ['IsProd', 'a', 'b'] })).toBe('a');
    expect(at.resolve({ 'Fn::If': ['Owned', 'a', 'b'] })).toBeInstanceOf(Unread);
    expect(at.resolve({ 'Fn::If': ['Owned', 'same', 'same'] })).toBe('same');
    expect(at.resolve({ A: { 'Fn::If': ['IsProd', { Ref: 'AWS::NoValue' }, 'x'] }, B: 1 })).toEqual({ B: 1 });
    expect(resolver(document).condition('IsProd')).toBeInstanceOf(Unread);
  });

  it('finds in mappings, selects, splits and joins what is text', () => {
    const at = resolver(document, { Stage: 'prod' });
    expect(at.resolve({ 'Fn::FindInMap': ['Rates', { Ref: 'Stage' }, 'Audit'] })).toBe('rate(1 hour)');
    expect(at.resolve({ 'Fn::FindInMap': ['Rates', 'dev', 'Audit'] })).toBeInstanceOf(Unread);
    expect(at.resolve({ 'Fn::Select': [1, { 'Fn::Split': [',', 'x,y,z'] }] })).toBe('y');
    expect(at.resolve({ 'Fn::Join': ['-', [{ Ref: 'Prefix' }, 'a']] })).toBe('shop-a');
    expect(at.resolve({ 'Fn::Join': ['-', [{ Ref: 'Prefix' }, { Ref: 'Queue' }]] })).toEqual({ 'Fn::Join': ['-', ['shop', { Ref: 'Queue' }]] });
    expect(at.resolve({ 'Fn::Select': [0, { 'Fn::GetAZs': '' }] })).toBeInstanceOf(Unread);
  });

  it('writes out a loop over a settled collection, and says one over a collection nothing settles', () => {
    const at = resolver(document, { Stage: 'prod' });
    const expanded = expandLoops(
      {
        'Fn::ForEach::Queues': ['Name', ['orders', 'refunds'], { '${Name}Queue': { Type: 'AWS::SQS::Queue', Properties: { QueueName: { 'Fn::Sub': '${Name}-${Stage}' }, Tag: { Ref: 'Name' } } } }],
        'Fn::ForEach::Owners': ['Name', { Ref: 'Owner' }, { '${Name}Topic': { Type: 'AWS::SNS::Topic' } }],
        Plain: { Type: 'AWS::SNS::Topic' },
      },
      at,
      ['Resources'],
    );
    expect(Object.keys(expanded.resources).sort()).toEqual(['Plain', 'ordersQueue', 'refundsQueue']);
    expect(expanded.resources['ordersQueue']).toEqual({ Type: 'AWS::SQS::Queue', Properties: { QueueName: { 'Fn::Sub': 'orders-${Stage}' }, Tag: 'orders' } });
    expect(expanded.paths.get('ordersQueue')).toEqual(['Resources', 'Fn::ForEach::Queues', 2, 'ordersQueue']);
    expect(expanded.repeated.map((loop) => loop.loop)).toEqual(['Owners']);
  });
});

describe('which templates a repository has', () => {
  it('finds templates of the transform, not its build output, not one another nests, and the one samconfig names', () => {
    const repoDir = repository({
      'template.yaml': template('Child:\n  Type: AWS::Serverless::Application\n  Properties:\n    Location: nested/template.yaml'),
      'nested/template.yaml': template('Fn:\n  Type: AWS::Serverless::Function'),
      '.aws-sam/build/template.yaml': template('Fn:\n  Type: AWS::Serverless::Function'),
      'plain/template.yaml': 'Resources:\n  Queue:\n    Type: AWS::SQS::Queue\n',
      'billing/samconfig.toml': '[default.deploy.parameters]\ntemplate_file = "infra/billing.yaml"\n',
      'billing/infra/billing.yaml': template('Fn:\n  Type: AWS::Serverless::Function'),
    });
    expect(templateFiles(repoDir)).toEqual(['billing/infra/billing.yaml', 'template.yaml']);
    expect(samReader.declares(repoDir)).toBe(true);
    expect(samReader.declares(repository({ 'template.yaml': 'Resources: {}\n' }))).toBe(false);
  });
});

describe('functions', () => {
  it('merges Globals under each function, and finds the handler in its CodeUri', () => {
    const deployment = read({
      'template.yaml': template(
        [
          'Place:',
          '  Type: AWS::Serverless::Function',
          '  Properties:',
          '    FunctionName: shop-place',
          '    Handler: orders/place.handler',
          '    Environment:',
          '      Variables:',
          '        QUEUE_URL: !Ref Queue',
          'Built:',
          '  Type: AWS::Serverless::Function',
          '  Metadata:',
          '    BuildMethod: esbuild',
          '    BuildProperties:',
          '      EntryPoints: [orders/built.ts]',
          '  Properties:',
          '    FunctionName: shop-built',
          '    CodeUri: ./',
          '    Handler: built.main',
          'Queue:',
          '  Type: AWS::SQS::Queue',
          '  Properties:',
          '    QueueName: shop-orders',
        ].join('\n'),
        'Globals:\n  Function:\n    Runtime: nodejs20.x\n    CodeUri: src/\n    Environment:\n      Variables:\n        STAGE: prod\n',
      ),
    });
    const [place, built] = deployment.functions;
    expect(place).toMatchObject({ name: 'shop-place', runtime: 'nodejs20.x', handler: { module: 'orders/place', export: 'handler', directory: 'src' } });
    expect(place?.environment?.['STAGE']).toMatchObject({ text: 'prod' });
    expect(place?.environment?.['QUEUE_URL']).toMatchObject({ names: { kind: 'queue', name: 'shop-orders' } });
    expect(built).toMatchObject({ name: 'shop-built', handler: { module: 'orders/built', export: 'main', directory: '.' } });
  });

  it('names a function with no FunctionName by its declaration, which what points at it joins', () => {
    const deployment = read({
      'template.yaml': template(
        [
          'Worker:',
          '  Type: AWS::Serverless::Function',
          '  Properties:',
          '    Handler: worker.handler',
          'Rule:',
          '  Type: AWS::Events::Rule',
          '  Properties:',
          '    ScheduleExpression: rate(1 hour)',
          '    Targets:',
          '      - Id: worker',
          '        Arn: !GetAtt Worker.Arn',
        ].join('\n'),
      ),
    });
    expect(deployment.functions[0]?.name).toBeUndefined();
    expect(deployment.functions[0]?.meta).toMatchObject({ nameGenerated: true });
    expect(deployment.deliveries[0]?.to).toEqual({ kind: 'function', function: 0 });
    expect(reasons(deployment)).toContain('deployed-name-generated');
    expect(generatedName('Resources.Worker')).toBe('${…}@Resources.Worker');
  });

  it('says what it cannot point at: a name nothing settles, inline code, an image, another runtime', () => {
    const deployment = read({
      'template.yaml': template(
        [
          'Owned:',
          '  Type: AWS::Serverless::Function',
          '  Properties:',
          '    FunctionName: !Sub ${Owner}-fn',
          '    Handler: a.handler',
          'Inline:',
          '  Type: AWS::Serverless::Function',
          '  Properties:',
          '    Handler: index.handler',
          "    InlineCode: 'exports.handler = 1'",
          'Image:',
          '  Type: AWS::Serverless::Function',
          '  Properties:',
          '    PackageType: Image',
          'Python:',
          '  Type: AWS::Serverless::Function',
          '  Properties:',
          '    Runtime: python3.12',
          '    Handler: app.handler',
        ].join('\n'),
        'Parameters:\n  Owner:\n    Type: String\n',
      ),
    });
    const owned = deployment.rows.find((row) => row.reason === 'function-name-unread');
    expect(owned?.meta).toEqual({ variable: 'Owner' });
    expect(owned?.message).toContain('the parameter Owner has no value');
    expect(reasons(deployment)).toEqual(expect.arrayContaining(['function-handler-unread', 'function-image-unread', 'function-runtime-unread']));
    expect(deployment.functions.find((fn) => fn.address === 'Resources.Python')?.handler).toBeUndefined();
  });

  it("reads a plain Lambda function, its URL and its destinations; and the URL a SAM function's config declares, named by the function (P54)", () => {
    const deployment = read({
      'template.yaml': template(
        [
          'Kiosk:',
          '  Type: AWS::Lambda::Function',
          '  Properties:',
          '    FunctionName: shop-kiosk',
          '    Runtime: nodejs20.x',
          '    Handler: kiosk.handler',
          '    Code: src/',
          'KioskUrl:',
          '  Type: AWS::Lambda::Url',
          '  Properties:',
          '    TargetFunctionArn: !GetAtt Kiosk.Arn',
          '    AuthType: AWS_IAM',
          'Receipt:',
          '  Type: AWS::Serverless::Function',
          '  Properties:',
          '    FunctionName: shop-receipt',
          '    Handler: receipt.handler',
          '    FunctionUrlConfig:',
          '      AuthType: NONE',
          '    DeadLetterQueue:',
          '      Type: SQS',
          '      TargetArn: !GetAtt Failed.Arn',
          '    EventInvokeConfig:',
          '      DestinationConfig:',
          '        OnSuccess:',
          '          Type: EventBridge',
          '          Destination: !GetAtt Bus.Arn',
          '    Environment:',
          '      Variables:',
          '        KIOSK_URL: !GetAtt KioskUrl.FunctionUrl',
          '        SELF_URL: !GetAtt ReceiptUrl.FunctionUrl',
          'Failed:',
          '  Type: AWS::SQS::Queue',
          '  Properties:',
          '    QueueName: shop-failed',
          'Bus:',
          '  Type: AWS::Events::EventBus',
          '  Properties:',
          '    Name: shop',
        ].join('\n'),
      ),
    });
    expect(deployment.functions[0]).toMatchObject({ name: 'shop-kiosk', handler: { module: 'kiosk', directory: 'src' } });
    expect(deployment.routes.map((route) => [route.meta?.['key'], route.target, route.guards?.[0]?.label])).toEqual([
      ['ALL:/*@shop-receipt', { function: 1 }, undefined],
      ['ALL:/*@shop-kiosk', { function: 0 }, 'AWS_IAM'],
    ]);
    const receipt = deployment.functions[1];
    expect(receipt?.environment?.['KIOSK_URL']?.names).toEqual({ kind: 'url', name: 'shop-kiosk' });
    expect(receipt?.environment?.['SELF_URL']?.names).toEqual({ kind: 'url', name: 'shop-receipt' });
    expect(deployment.deliveries.map((delivery) => [delivery.by, delivery.from, delivery.to])).toEqual([
      ['destination', { kind: 'outcome', when: 'success', of: { function: 1 } }, { kind: 'bus', name: 'shop', fields: { source: 'lambda', 'detail-type': 'Lambda Function Invocation Result - Success' } }],
      ['destination', { kind: 'outcome', when: 'failure', of: { function: 1 } }, { kind: 'queue', name: 'shop-failed' }],
    ]);
  });
});

describe('events', () => {
  const fn = (events: string, extra = ''): string =>
    template(
      [
        'Fn:',
        '  Type: AWS::Serverless::Function',
        '  Properties:',
        '    FunctionName: shop-fn',
        '    Handler: fn.handler',
        '    Events:',
        events.replace(/^/gm, '      '),
        extra,
      ].join('\n'),
    );

  it('reads every channel a function is run from, as Terraform draws it', () => {
    const deployment = read({
      'template.yaml': fn(
        [
          'Q: { Type: SQS, Properties: { Queue: !GetAtt Queue.Arn, Enabled: false, FilterCriteria: { Filters: [{ Pattern: "{}" }] } } }',
          'T: { Type: SNS, Properties: { Topic: !Ref Topic, FilterPolicy: { kind: [a] }, SqsSubscription: true } }',
          'D: { Type: DynamoDB, Properties: { Stream: !GetAtt Table.StreamArn, DestinationConfig: { OnFailure: { Destination: !GetAtt Queue.Arn } } } }',
          'K: { Type: Kinesis, Properties: { Stream: !GetAtt Stream.Arn } }',
          'S: { Type: S3, Properties: { Bucket: !Ref Bucket, Events: [s3:ObjectRemoved:*], Filter: { S3Key: { Rules: [{ Name: prefix, Value: in/ }] } } } }',
          'C: { Type: Schedule, Properties: { Schedule: rate(1 day), Name: daily, Enabled: false } }',
          'V: { Type: ScheduleV2, Properties: { ScheduleExpression: cron(0 1 * * ? *), State: DISABLED } }',
          'R: { Type: EventBridgeRule, Properties: { EventBusName: !Ref Bus, RuleName: placed, Pattern: { source: [shop] } } }',
          'W: { Type: CloudWatchEvent, Properties: { Pattern: { detail-type: [Tick] } } }',
          'P: { Type: Cognito, Properties: { UserPool: !Ref Pool, Trigger: [PreSignUp, CustomSMSSender] } }',
          'I: { Type: IoTRule, Properties: { Sql: "SELECT * FROM \'shop/doors/+\'" } }',
          'L: { Type: CloudWatchLogs, Properties: { LogGroupName: x } }',
        ].join('\n'),
        [
          'Queue: { Type: AWS::SQS::Queue, Properties: { QueueName: shop-q } }',
          'Topic: { Type: AWS::SNS::Topic, Properties: { TopicName: shop-t } }',
          'Table: { Type: AWS::DynamoDB::Table, Properties: { TableName: shop-orders, StreamSpecification: { StreamViewType: NEW_IMAGE } } }',
          'Stream: { Type: AWS::Kinesis::Stream, Properties: { Name: shop-s } }',
          'Bucket: { Type: AWS::S3::Bucket, Properties: { BucketName: shop-b } }',
          'Bus: { Type: AWS::Events::EventBus, Properties: { Name: shop } }',
          'Pool: { Type: AWS::Cognito::UserPool, Properties: { UserPoolName: shop-members } }',
        ].join('\n'),
      ),
    });
    const drawn = deployment.deliveries.map((delivery) => [delivery.by, delivery.from.kind === 'bus' ? { kind: 'bus', name: delivery.from.name } : delivery.from, delivery.meta?.['disabled'] ?? false]);
    expect(drawn).toEqual([
      ['mapping', { kind: 'queue', name: 'shop-q' }, true],
      ['subscription', { kind: 'topic', name: 'shop-t' }, false],
      ['mapping', { kind: 'changes', of: 'table', name: 'shop-orders' }, false],
      ['destination', { kind: 'outcome', when: 'failure', of: { delivery: 'Resources.Fn.Events.D' } }, false],
      ['mapping', { kind: 'changes', of: 'stream', name: 'shop-s' }, false],
      ['notification', { kind: 'bucket', name: 'shop-b', events: ['s3:ObjectRemoved:*'], prefix: 'in/' }, false],
      ['schedule', { kind: 'schedule', expression: 'rate(1 day)' }, true],
      ['schedule', { kind: 'schedule', expression: 'cron(0 1 * * ? *)' }, true],
      ['rule', { kind: 'bus', name: 'shop' }, false],
      ['rule', { kind: 'bus', name: 'default' }, false],
      ['trigger', { kind: 'trigger', service: 'cognito', key: 'cognito/shop-members/pre_sign_up' }, false],
      ['trigger', { kind: 'trigger', service: 'cognito', key: 'cognito/shop-members/custom_sms_sender' }, false],
      ['rule', { kind: 'trigger', service: 'iot', key: 'iot/shop/doors/+' }, false],
    ]);
    expect(deployment.deliveries[1]?.meta).toMatchObject({ queued: true, unmatched: { filter_policy: '{"kind":["a"]}' } });
    expect(deployment.deliveries[0]?.meta).toMatchObject({ unmatched: { filter: ['{}'] } });
    expect(deployment.rows.find((row) => row.reason === 'invoker-not-read')?.symbol).toBe('Resources.Fn.Events.L');
    expect(deployment.streams).toEqual([expect.objectContaining({ of: 'table', name: 'shop-orders' }), expect.objectContaining({ of: 'stream', name: 'shop-s' })]);
  });

  it('hangs routes from the API an event names, the implicit one taking the stack name, with the guards it is behind', () => {
    const deployment = read(
      {
        'template.yaml': fn(
          [
            'Get: { Type: Api, Properties: { Path: "/orders/{id}", Method: get, Auth: { ApiKeyRequired: true } } }',
            'Post: { Type: Api, Properties: { RestApiId: !Ref Admin, Path: /orders, Method: post } }',
            'All: { Type: HttpApi }',
            'Bad: { Type: Api, Properties: { RestApiId: !ImportValue shared-api, Path: /x, Method: get } }',
          ].join('\n'),
          'Admin: { Type: AWS::Serverless::Api, Properties: { Name: shop-admin, StageName: v1, Auth: { DefaultAuthorizer: Staff } } }',
        ),
        'samconfig.toml': '[default.deploy.parameters]\nstack_name = "shop-prod"\n',
      },
    );
    expect(deployment.routes.map((route) => [route.method, route.path, route.api, route.meta?.['stage'], route.guards?.map((guard) => guard.label)])).toEqual([
      ['GET', '/orders/:param', 'shop-prod', 'Prod', ['api key']],
      ['POST', '/orders', 'shop-admin', 'v1', ['Staff']],
      ['ALL', '/:param', 'shop-prod', '$default', undefined],
    ]);
    expect(reasons(deployment)).toContain('route-path-unread');
  });
});

describe('APIs written on their own', () => {
  it('reads routes from an OpenAPI body in place and included, and from a socket and a REST API written as resources', () => {
    const deployment = read({
      'template.yaml': template(
        [
          'Fn:',
          '  Type: AWS::Serverless::Function',
          '  Properties: { FunctionName: shop-fn, Handler: fn.handler }',
          'Catalog:',
          '  Type: AWS::Serverless::Api',
          '  Properties:',
          '    StageName: v1',
          '    DefinitionBody:',
          '      paths:',
          '        /books/{isbn}:',
          '          get:',
          '            x-amazon-apigateway-integration:',
          '              uri: !Sub arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Fn.Arn}/invocations',
          'Included:',
          '  Type: AWS::Serverless::HttpApi',
          '  Properties:',
          '    DefinitionBody:',
          "      'Fn::Transform': { Name: 'AWS::Include', Parameters: { Location: api.yaml } }",
          'Socket: { Type: AWS::ApiGatewayV2::Api, Properties: { Name: shop-live, ProtocolType: WEBSOCKET } }',
          'Integration:',
          '  Type: AWS::ApiGatewayV2::Integration',
          '  Properties: { ApiId: !Ref Socket, IntegrationUri: !GetAtt Fn.Arn }',
          'Connect:',
          '  Type: AWS::ApiGatewayV2::Route',
          '  Properties: { ApiId: !Ref Socket, RouteKey: $connect, Target: !Sub "integrations/${Integration}" }',
          'Rest: { Type: AWS::ApiGateway::RestApi, Properties: { Name: shop-rest } }',
          'Orders: { Type: AWS::ApiGateway::Resource, Properties: { RestApiId: !Ref Rest, ParentId: !GetAtt Rest.RootResourceId, PathPart: orders } }',
          'Method:',
          '  Type: AWS::ApiGateway::Method',
          '  Properties:',
          '    RestApiId: !Ref Rest',
          '    ResourceId: !Ref Orders',
          '    HttpMethod: PUT',
          '    AuthorizationType: AWS_IAM',
          '    Integration: { Uri: !Sub "arn:aws:apigateway:eu-west-1:lambda:path/2015-03-31/functions/${Fn.Arn}/invocations" }',
          'Broken: { Type: AWS::Serverless::Api, Properties: { DefinitionUri: s3://bucket/api.yaml } }',
        ].join('\n'),
      ),
      'api.yaml': "paths:\n  /shelves:\n    post:\n      x-amazon-apigateway-integration:\n        uri: !Sub 'arn:aws:apigateway:eu-west-1:lambda:path/2015-03-31/functions/${Fn.Arn}/invocations'\n",
    });
    expect(deployment.routes.map((route) => [route.method, route.path, route.file, route.target, route.guards?.[0]?.label])).toEqual([
      ['GET', '/books/:param', 'template.yaml', { function: 0 }, undefined],
      ['POST', '/shelves', 'api.yaml', { function: 0 }, undefined],
      ['PUT', '/orders', 'template.yaml', { function: 0 }, 'AWS_IAM'],
    ]);
    expect(deployment.deliveries).toEqual([expect.objectContaining({ by: 'route', from: { kind: 'connection', api: 'shop-live', route: '$connect' }, to: { kind: 'function', function: 0 } })]);
    expect(reasons(deployment)).toContain('api-body-unread');
  });
});

describe('state machines', () => {
  it('reads a definition in place and one in a file, each placeholder answered with what it names, and their events', () => {
    const deployment = read({
      'template.yaml': template(
        [
          'Fn: { Type: AWS::Serverless::Function, Properties: { FunctionName: shop-fn, Handler: fn.handler } }',
          'Inline:',
          '  Type: AWS::Serverless::StateMachine',
          '  Properties:',
          '    Name: shop-inline',
          '    Definition:',
          '      StartAt: Run',
          '      States:',
          '        Run: { Type: Task, Resource: !GetAtt Fn.Arn, End: true }',
          '    Events:',
          '      Tick: { Type: Schedule, Properties: { Schedule: rate(1 hour) } }',
          '      Start: { Type: Api, Properties: { Path: /start, Method: post } }',
          'FromFile:',
          '  Type: AWS::Serverless::StateMachine',
          '  Properties:',
          '    DefinitionUri: machine.asl.json',
          '    DefinitionSubstitutions: { FnArn: !GetAtt Fn.Arn, Literal: plain }',
          '    Events:',
          '      Placed: { Type: EventBridgeRule, Properties: { Pattern: { source: [shop] } } }',
          'Missing: { Type: AWS::Serverless::StateMachine, Properties: { Name: shop-missing, DefinitionUri: nowhere.json } }',
        ].join('\n'),
      ),
      'machine.asl.json': '{"StartAt":"Run","States":{"Run":{"Type":"Task","Resource":"${FnArn}","End":true}}}',
    });
    const [inline, fromFile] = deployment.workflows;
    expect(inline?.name).toBe('shop-inline');
    expect(inline?.definition?.kind).toBe('value');
    expect(inline?.fill('ref0')).toBe('arn:aws:lambda:::function:shop-fn');
    expect(fromFile?.name).toBeUndefined();
    expect(fromFile?.meta).toMatchObject({ nameGenerated: true });
    expect(fromFile?.definition).toMatchObject({ kind: 'text', file: 'machine.asl.json', format: 'json' });
    expect(fromFile?.fill('FnArn')).toBe('arn:aws:lambda:::function:shop-fn');
    expect(fromFile?.fill('Literal')).toBe('plain');
    expect(deployment.deliveries.map((delivery) => [delivery.by, delivery.to])).toEqual([
      ['schedule', { kind: 'workflow', name: 'shop-inline' }],
      ['rule', { kind: 'workflow', name: generatedName('Resources.FromFile') }],
    ]);
    expect(reasons(deployment)).toEqual(expect.arrayContaining(['route-target-unread', 'workflow-definition-not-loaded', 'deployed-name-generated']));
  });
});

describe('conditions, nesting and macros', () => {
  it("reads what an unsettled condition declares, marked, and leaves out what a settled one does not deploy", () => {
    const deployment = read(
      {
        'template.yaml': template(
          [
            'Audit:',
            '  Type: AWS::Serverless::Function',
            '  Condition: Audited',
            '  Properties:',
            '    FunctionName: shop-audit',
            '    Handler: audit.handler',
            '    Events: { Tick: { Type: Schedule, Properties: { Schedule: rate(1 hour) } } }',
            'Seed:',
            '  Type: AWS::Serverless::Function',
            '  Condition: IsDev',
            '  Properties: { FunctionName: shop-seed, Handler: seed.handler }',
          ].join('\n'),
          "Parameters:\n  Stage: { Type: String }\n  Audit: { Type: String }\nConditions:\n  IsDev: !Equals [!Ref Stage, dev]\n  Audited: !Equals [!Ref Audit, 'yes']\n",
        ),
      },
      { Stage: 'prod' },
    );
    expect(deployment.functions.map((fn) => fn.name)).toEqual(['shop-audit']);
    expect(deployment.functions[0]?.meta).toMatchObject({ conditional: 'Audited' });
    expect(deployment.deliveries[0]?.meta).toMatchObject({ conditional: 'Audited' });
    expect(reasons(deployment)).toContain('construct-conditional');
  });

  it('reads a nested template of the repository under the parameters handed to it, and its outputs where the parent points at them', () => {
    const deployment = read({
      'template.yaml': template(
        [
          'Topic: { Type: AWS::SNS::Topic, Properties: { TopicName: shop-shipped } }',
          'Notices:',
          '  Type: AWS::Serverless::Application',
          '  Properties:',
          '    Location: ./notices/template.yaml',
          '    Parameters: { TopicArn: !Ref Topic, Stage: prod }',
          'Rule:',
          '  Type: AWS::Events::Rule',
          '  Properties:',
          '    EventPattern: { source: [shop] }',
          '    Targets: [{ Id: a, Arn: !GetAtt Notices.Outputs.SenderArn }]',
          'Remote:',
          '  Type: AWS::Serverless::Application',
          '  Properties:',
          '    Location: { ApplicationId: arn:aws:serverlessrepo:us-east-1:111122223333:applications/x, SemanticVersion: 1.0.0 }',
          'Loop:',
          '  Type: AWS::CloudFormation::Stack',
          '  Properties: { TemplateURL: template.yaml }',
        ].join('\n'),
      ),
      'notices/template.yaml': template(
        'Sender:\n  Type: AWS::Serverless::Function\n  Properties:\n    FunctionName: !Sub shop-${Stage}-sender\n    Handler: sender.handler\n    Events: { Shipped: { Type: SNS, Properties: { Topic: !Ref TopicArn } } }',
        'Parameters:\n  TopicArn: { Type: String }\n  Stage: { Type: String }\n',
      ) + 'Outputs:\n  SenderArn:\n    Value: !GetAtt Sender.Arn\n',
    });
    expect(deployment.functions).toEqual([expect.objectContaining({ name: 'shop-prod-sender', address: 'Notices.Resources.Sender', handler: expect.objectContaining({ directory: 'notices' }) })]);
    expect(deployment.deliveries.map((delivery) => [delivery.by, delivery.from.kind === 'topic' ? delivery.from.name : delivery.from.kind, delivery.to])).toEqual([
      ['subscription', 'shop-shipped', { kind: 'function', function: 0 }],
      ['rule', 'bus', { kind: 'function', function: 0 }],
    ]);
    expect(deployment.rows.filter((row) => row.reason === 'nested-deployment-unread').map((row) => row.symbol)).toEqual(['Resources.Remote', 'Resources.Loop']);
  });

  it('says a macro it does not run, a loop it cannot write out, a layer, and a template that does not parse', () => {
    const deployment = read({
      'template.yaml': template(
        [
          "'Fn::ForEach::Queues':",
          '  - Name',
          '  - !Ref Names',
          "  - '${Name}Queue': { Type: AWS::SQS::Queue }",
          'Layer: { Type: AWS::Serverless::LayerVersion, Properties: { ContentUri: layer/ } }',
        ].join('\n'),
        'Parameters:\n  Names: { Type: CommaDelimitedList }\n',
      ).replace('Transform: AWS::Serverless-2016-10-31', 'Transform: [AWS::LanguageExtensions, AWS::Serverless-2016-10-31, Stamps]'),
      'broken/template.yaml': 'Transform: AWS::Serverless-2016-10-31\nResources: [\n',
    });
    expect(reasons(deployment).sort()).toEqual(['construct-repeated-unread', 'deployment-plugin-unread', 'infra-file-unparsed', 'layer-not-followed']);
  });
});

describe('the reader', () => {
  it('reads every template with what samconfig gives, and stamps the files it read beside them', () => {
    const repoDir = repository({
      'template.yaml': template('Fn:\n  Type: AWS::Serverless::Function\n  Properties:\n    FunctionName: !Sub "${AWS::StackName}-fn"\n    Handler: fn.handler', 'Parameters:\n  Stage: { Type: String }\n'),
      'samconfig.toml': '[default.deploy.parameters]\nstack_name = "shop-dev"\nparameter_overrides = "Stage=dev"\n',
    });
    const config = parseConfig({});
    expect(samReader.read({ repoDir, config }).functions[0]?.name).toBe('shop-dev-fn');
    expect(samReader.files(repoDir, { config })).toEqual(['samconfig.toml', 'template.yaml']);
  });
});

/** The plain CloudFormation reader over a repository of the files given (P248). */
const readPlain = (files: Record<string, string>, options?: Record<string, string>): Deployment => {
  const repoDir = repository(files);
  return cloudFormationReader.read({
    repoDir,
    config: parseConfig({}),
    service: { name: 'svc', repo: repoDir, type: 'lambda', ...(options === undefined ? {} : { infra: { vars: [], options } }) },
  });
};

/** A plain template, its resources indented under `Resources:`. */
const plain = (resources: string, head = ''): string => `AWSTemplateFormatVersion: '2010-09-09'\n${head}Resources:\n${resources.replace(/^/gm, '  ')}\n`;

describe('plain CloudFormation templates (P248)', () => {
  it('finds a template by what it says, under any name and anywhere, and leaves out what another reader reads or a template nests', () => {
    const repoDir = repository({
      'stacks/queues.yaml': plain('Q: { Type: AWS::SQS::Queue }'),
      'infra/network/vpc.json': JSON.stringify({ Resources: { Vpc: { Type: 'AWS::EC2::VPC' } } }),
      'legacy/orders.template': plain('T: { Type: AWS::SNS::Topic }'),
      'template.yaml': template('Fn: { Type: AWS::Serverless::Function }'),
      'openapi.yaml': 'openapi: 3.0.0\npaths: {}\n',
      'package.json': '{ "name": "svc", "description": "Resources for AWS::Lambda" }',
      'broken.yaml': 'AWSTemplateFormatVersion: [\n',
      'node_modules/kit/stack.yaml': plain('Q: { Type: AWS::SQS::Queue }'),
      'dist/stack.yaml': plain('Q: { Type: AWS::SQS::Queue }'),
      // The CDK reads the app beside this one; the other is checked in with no app.
      'app/cdk.json': '{ "app": "npx ts-node bin/app.ts" }',
      'app/cdk.out/AppStack.template.json': JSON.stringify({ Resources: { Q: { Type: 'AWS::SQS::Queue' } } }),
      'old/cdk.out/OldStack.template.json': JSON.stringify({ Resources: { Q: { Type: 'AWS::SQS::Queue' } } }),
      // What a service of the framework loads into its resources is the Serverless reader's.
      'svc/serverless.yml': 'service: svc\nprovider:\n  name: aws\nresources: ${file(./resources.yml)}\n',
      'svc/resources.yml': 'Resources:\n  Q: { Type: AWS::SQS::Queue }\n',
      'parent.yaml': plain('Child: { Type: AWS::CloudFormation::Stack, Properties: { TemplateURL: nested/child.yaml } }'),
      'nested/child.yaml': plain('Q: { Type: AWS::SQS::Queue }'),
      // What `aws cloudformation package` and `sam package` write: the same resources, uploaded.
      'fns/stack.yaml': plain('Fn: { Type: AWS::Lambda::Function, Properties: { Code: ../src } }'),
      'fns/packaged.yaml': plain('Fn: { Type: AWS::Lambda::Function, Properties: { Code: { S3Bucket: b, S3Key: k } } }'),
      'api/packaged.yaml': template('Fn: { Type: AWS::Serverless::Function, Properties: { CodeUri: s3://b/k } }'),
      'api/api.yaml': template('Fn: { Type: AWS::Serverless::Function }'),
    });
    expect(cloudFormationFiles(repoDir)).toEqual(['fns/stack.yaml', 'infra/network/vpc.json', 'legacy/orders.template', 'old/cdk.out/OldStack.template.json', 'parent.yaml', 'stacks/queues.yaml']);
    expect(templateFiles(repoDir)).toEqual(['api/api.yaml', 'template.yaml']);
    const copies = (reader: typeof samReader): string[] =>
      reader
        .read({ repoDir, config: parseConfig({}) })
        .rows.filter((row) => row.reason === 'deployment-copy-not-read')
        .map((row) => row.file);
    expect(copies(cloudFormationReader)).toEqual(['fns/packaged.yaml']);
    expect(copies(samReader)).toEqual(['api/packaged.yaml']);
    expect(cloudFormationReader.declares(repository({ 'readme.md': '# no template' }), parseConfig({}))).toBe(false);
  });

  it('reads a plain template as the SAM reader reads its resources, its addresses under the file, and says what only the transform reads', () => {
    const deployment = readPlain({
      'stacks/shop.yaml': plain(
        [
          'Fn:',
          '  Type: AWS::Lambda::Function',
          '  Properties: { FunctionName: shop-fn, Runtime: nodejs20.x, Handler: orders/place.handler, Code: ../src }',
          'Queue: { Type: AWS::SQS::Queue }',
          'Mapping:',
          '  Type: AWS::Lambda::EventSourceMapping',
          '  Properties: { EventSourceArn: !GetAtt Queue.Arn, FunctionName: !Ref Fn }',
          'Logs:',
          '  Type: AWS::Lambda::Permission',
          '  Properties: { Action: lambda:InvokeFunction, FunctionName: !Ref Fn, Principal: logs.amazonaws.com }',
          'Bucket:',
          '  Type: AWS::Lambda::Permission',
          '  Properties: { Action: lambda:InvokeFunction, FunctionName: !Ref Fn, Principal: s3.amazonaws.com }',
          'Public:',
          '  Type: AWS::Lambda::Permission',
          "  Properties: { Action: lambda:InvokeFunctionUrl, FunctionName: !Ref Fn, Principal: '*', FunctionUrlAuthType: NONE }",
          'Other: { Type: AWS::Serverless::Function, Properties: { Handler: x.handler } }',
        ].join('\n'),
        'Globals:\n  Function: { Runtime: nodejs20.x }\n',
      ),
    });
    expect(deployment.functions).toEqual([expect.objectContaining({ name: 'shop-fn', address: 'stacks/shop.Resources.Fn', handler: expect.objectContaining({ module: 'orders/place', directory: 'src' }) })]);
    expect(deployment.deliveries).toEqual([
      expect.objectContaining({ by: 'mapping', from: { kind: 'queue', name: generatedName('stacks/shop.Resources.Queue') }, to: { kind: 'function', function: 0 } }),
    ]);
    expect(deployment.rows.map((row) => [row.reason, row.symbol])).toEqual([
      ['deployment-plugin-unread', 'stacks/shop.yaml#Transform'],
      // A stand-in is spelled as an unnamed function's key is, a dot for each slash.
      ['deployed-name-generated', 'stacks.shop.Resources.Queue'],
      ['invoker-not-read', 'stacks/shop.Resources.Logs'],
    ]);
    expect(deployment.rows[0]?.message).toContain('AWS::Serverless::Function, Globals');
  });

  it("joins an import to another template's export, however the templates are ordered, and says one no template or two declare", () => {
    const deployment = readPlain(
      {
        // Read first, and imports what the last one exports.
        'a-functions.yaml': plain(
          [
            'Fn:',
            '  Type: AWS::Lambda::Function',
            '  Properties:',
            '    FunctionName: shop-fn',
            '    Handler: fn.handler',
            '    Code: src/',
            '    Environment:',
            '      Variables:',
            '        QUEUE_URL: { "Fn::ImportValue": !Sub "${Stage}-holds-url" }',
            '        BUS: !ImportValue shop-bus',
            '        NOWHERE: !ImportValue shop-nowhere',
            '        TWICE: !ImportValue shop-twice',
            'Holds:',
            '  Type: AWS::Lambda::EventSourceMapping',
            '  Properties: { EventSourceArn: { "Fn::ImportValue": !Sub "${Stage}-holds-arn" }, FunctionName: !Ref Fn }',
            'Changes:',
            '  Type: AWS::Lambda::EventSourceMapping',
            '  Properties: { EventSourceArn: !ImportValue shop-table-stream, FunctionName: !Ref Fn, StartingPosition: LATEST }',
          ].join('\n'),
          'Parameters:\n  Stage: { Type: String }\n',
        ),
        // Exports what it imports in turn: settled on a later pass.
        'b-relay.yaml': plain('Unused: { Type: AWS::SNS::Topic, Properties: { TopicName: shop-unused } }') + 'Outputs:\n  Bus:\n    Value: !ImportValue shop-bus-source\n    Export: { Name: shop-bus }\n',
        'c-storage.json': JSON.stringify({
          Parameters: { Stage: { Type: 'String' } },
          Resources: {
            Holds: { Type: 'AWS::SQS::Queue' },
            Bus: { Type: 'AWS::Events::EventBus', Properties: { Name: 'shop' } },
            Table: { Type: 'AWS::DynamoDB::Table', Properties: { TableName: 'shop-orders', StreamSpecification: { StreamViewType: 'NEW_IMAGE' } } },
          },
          Outputs: {
            HoldsUrl: { Value: { Ref: 'Holds' }, Export: { Name: { 'Fn::Sub': '${Stage}-holds-url' } } },
            HoldsArn: { Value: { 'Fn::GetAtt': ['Holds', 'Arn'] }, Export: { Name: { 'Fn::Sub': '${Stage}-holds-arn' } } },
            BusName: { Value: { Ref: 'Bus' }, Export: { Name: 'shop-bus-source' } },
            Stream: { Value: { 'Fn::GetAtt': ['Table', 'StreamArn'] }, Export: { Name: 'shop-table-stream' } },
            One: { Value: 'a', Export: { Name: 'shop-twice' } },
          },
        }),
        'd-other.yaml': plain('T: { Type: AWS::SNS::Topic, Properties: { TopicName: shop-other } }') + 'Outputs:\n  Two:\n    Value: b\n    Export: { Name: shop-twice }\n',
      },
      { Stage: 'dev' },
    );
    const holds = generatedName('c-storage.Resources.Holds');
    const environment = deployment.functions[0]?.environment ?? {};
    expect(environment['QUEUE_URL']?.names).toEqual({ kind: 'queue', name: holds });
    expect(environment['BUS']?.names).toEqual({ kind: 'bus', name: 'shop' });
    expect(environment['NOWHERE']?.unread?.text).toBe('the value is imported from the export shop-nowhere, which no template of the repository declares');
    expect(environment['TWICE']?.unread?.text).toContain('the export shop-twice is declared by 2 templates (c-storage.json, d-other.yaml)');
    expect(deployment.deliveries.filter((delivery) => delivery.by === 'mapping').map((delivery) => [delivery.address, delivery.from])).toEqual([
      ['a-functions.Resources.Holds', { kind: 'queue', name: holds }],
      ['a-functions.Resources.Changes', { kind: 'changes', of: 'table', name: 'shop-orders' }],
    ]);
    // The SAM reader of the same repository is handed the same exports.
    expect(read({ 'template.yaml': template('Q: { Type: AWS::SQS::Queue, Properties: { QueueName: shop-q } }') + 'Outputs:\n  Q:\n    Value: !GetAtt Q.Arn\n    Export: { Name: shop-q-arn }\n', 'fns.yaml': plain('M:\n  Type: AWS::Lambda::EventSourceMapping\n  Properties: { EventSourceArn: !ImportValue shop-q-arn, FunctionName: shop-elsewhere }') }).rows).toEqual([]);
  });

  it('reads an HTTP API made in one resource, onto the function its Target runs, in a plain template and a SAM one', () => {
    const resources = [
      'Fn: { Type: AWS::Lambda::Function, Properties: { FunctionName: shop-fn, Handler: fn.handler, Code: src/ } }',
      'Quick: { Type: AWS::ApiGatewayV2::Api, Properties: { Name: shop-quick, ProtocolType: HTTP, Target: !GetAtt Fn.Arn } }',
      'Keyed: { Type: AWS::ApiGatewayV2::Api, Properties: { Name: shop-keyed, ProtocolType: HTTP, RouteKey: GET /status, Target: !Ref Fn } }',
      'Proxy: { Type: AWS::ApiGatewayV2::Api, Properties: { Name: shop-proxy, ProtocolType: HTTP, Target: "https://example.com" } }',
    ].join('\n');
    for (const deployment of [readPlain({ 'stack.yaml': plain(resources) }), read({ 'template.yaml': template(resources) })]) {
      expect(deployment.routes.map((route) => [route.method, route.path, route.api, route.target])).toEqual([
        ['ALL', '/:param', 'shop-quick', { function: 0 }],
        ['GET', '/status', 'shop-keyed', { function: 0 }],
      ]);
      expect(deployment.rows.filter((row) => row.reason === 'route-target-unread').map((row) => row.level)).toEqual(['info']);
    }
  });

  it('reads the OpenAPI body of a REST or HTTP API in place and from BodyS3Location, the stage it is deployed to, and the guards of its methods and routes', () => {
    const deployment = readPlain({
      'stacks/api.yaml': plain(
        [
          'Fn: { Type: AWS::Lambda::Function, Properties: { FunctionName: shop-fn, Handler: fn.handler, Code: ../src } }',
          'Rest:',
          '  Type: AWS::ApiGateway::RestApi',
          '  Properties:',
          '    Name: shop-rest',
          '    Body:',
          '      paths:',
          '        /books:',
          '          get:',
          '            x-amazon-apigateway-integration:',
          '              uri: !Sub arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Fn.Arn}/invocations',
          'RestStage: { Type: AWS::ApiGateway::Stage, Properties: { RestApiId: !Ref Rest, StageName: v1 } }',
          'Http: { Type: AWS::ApiGatewayV2::Api, Properties: { Name: shop-http, BodyS3Location: ../api/http.yaml } }',
          'Remote: { Type: AWS::ApiGateway::RestApi, Properties: { Name: shop-remote, BodyS3Location: { Bucket: specs, Key: api.yaml } } }',
          'Items: { Type: AWS::ApiGateway::Resource, Properties: { RestApiId: !Ref Rest, ParentId: !GetAtt Rest.RootResourceId, PathPart: items } }',
          'Put:',
          '  Type: AWS::ApiGateway::Method',
          '  Properties: { RestApiId: !Ref Rest, ResourceId: !Ref Items, HttpMethod: PUT, AuthorizationType: COGNITO_USER_POOLS, ApiKeyRequired: true, Integration: { Uri: !Sub "arn:aws:apigateway:eu-west-1:lambda:path/2015-03-31/functions/${Fn.Arn}/invocations" } }',
          'Integration: { Type: AWS::ApiGatewayV2::Integration, Properties: { ApiId: !Ref Http, IntegrationUri: !GetAtt Fn.Arn } }',
          'Route: { Type: AWS::ApiGatewayV2::Route, Properties: { ApiId: !Ref Http, RouteKey: DELETE /items, AuthorizationType: JWT, Target: !Sub "integrations/${Integration}" } }',
        ].join('\n'),
      ),
      'api/http.yaml': "paths:\n  /shelves:\n    post:\n      x-amazon-apigateway-integration:\n        uri: !Sub 'arn:aws:apigateway:eu-west-1:lambda:path/2015-03-31/functions/${Fn.Arn}/invocations'\n",
    });
    expect(deployment.routes.map((route) => [route.method, route.path, route.file, route.meta?.['stage'], route.guards?.map((guard) => guard.label)])).toEqual([
      ['GET', '/books', 'stacks/api.yaml', 'v1', undefined],
      ['POST', '/shelves', 'api/http.yaml', undefined, undefined],
      ['PUT', '/items', 'stacks/api.yaml', 'v1', ['COGNITO_USER_POOLS', 'api key']],
      ['DELETE', '/items', 'stacks/api.yaml', undefined, ['JWT']],
    ]);
    expect(reasons(deployment)).toEqual(['api-body-unread']);
  });

  it('reads a state machine from the file DefinitionS3Location names, and says one kept in a bucket', () => {
    const deployment = readPlain({
      'stacks/flow.yaml': plain(
        [
          'Fn: { Type: AWS::Lambda::Function, Properties: { FunctionName: shop-fn, Handler: fn.handler, Code: ../src } }',
          'Local:',
          '  Type: AWS::StepFunctions::StateMachine',
          '  Properties:',
          '    StateMachineName: shop-flow',
          '    StateMachineType: EXPRESS',
          '    DefinitionS3Location: ../flows/flow.asl.json',
          '    DefinitionSubstitutions: { fn_arn: !GetAtt Fn.Arn }',
          'Remote:',
          '  Type: AWS::StepFunctions::StateMachine',
          '  Properties: { StateMachineName: shop-remote, DefinitionS3Location: { Bucket: flows, Key: remote.json } }',
        ].join('\n'),
      ),
      'flows/flow.asl.json': JSON.stringify({ StartAt: 'Run', States: { Run: { Type: 'Task', Resource: '${fn_arn}', End: true } } }),
    });
    expect(deployment.workflows).toEqual([
      expect.objectContaining({ name: 'shop-flow', definition: expect.objectContaining({ kind: 'text', file: 'flows/flow.asl.json', format: 'json' }), meta: expect.objectContaining({ type: 'EXPRESS' }) }),
    ]);
    expect(deployment.workflows[0]?.fill?.('fn_arn')).toBe('arn:aws:lambda:::function:shop-fn');
    expect(deployment.rows.map((row) => [row.reason, row.symbol])).toEqual([['workflow-definition-not-loaded', 'stacks/flow.Resources.Remote']]);
  });

  it('reads with a samconfig only the template it deploys, in its directory or below, and stamps the templates whose exports it imports', () => {
    const repoDir = repository({
      'samconfig.toml': '[default.deploy.parameters]\nstack_name = "shop-dev"\ntemplate_file = "infra/deployed.yaml"\nparameter_overrides = "Stage=dev"\n',
      'infra/deployed.yaml': plain(
        'Fn: { Type: AWS::Lambda::Function, Properties: { FunctionName: !Sub "${AWS::StackName}-${Stage}", Handler: fn.handler, Code: src/, Environment: { Variables: { Q: !ImportValue shop-q-arn } } } }',
        'Parameters:\n  Stage: { Type: String }\n',
      ),
      'other.yaml': plain('Fn: { Type: AWS::Lambda::Function, Properties: { FunctionName: !Sub "other-${Stage}", Handler: fn.handler, Code: src/ } }', 'Parameters:\n  Stage: { Type: String }\n'),
      'shared.yaml': template('Q: { Type: AWS::SQS::Queue, Properties: { QueueName: shop-q } }') + 'Outputs:\n  Q:\n    Value: !GetAtt Q.Arn\n    Export: { Name: shop-q-arn }\n',
    });
    const config = parseConfig({});
    const deployment = cloudFormationReader.read({ repoDir, config });
    expect(deployment.functions.map((fn) => fn.name ?? fn.meta?.['nameUnread'])).toEqual(['shop-dev-dev', expect.stringContaining('the parameter Stage has no value')]);
    expect(deployment.functions[0]?.environment?.['Q']?.names).toEqual({ kind: 'queue', name: 'shop-q' });
    expect(reasons(deployment)).toEqual(['function-name-unread']);
    expect(cloudFormationReader.files(repoDir, { config })).toEqual(['infra/deployed.yaml', 'other.yaml', 'samconfig.toml', 'shared.yaml']);
    // The SAM template beside the file is not the one it deploys, and imports nothing.
    expect(samReader.files(repoDir, { config })).toEqual(['shared.yaml']);
  });
});
