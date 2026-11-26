import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { alternativeAddress, importedName, parseConfig, type Deployment } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { cloudFormationReader } from './index.js';
import { parameterValues } from './parameter-files.js';

const repository = (files: Record<string, string>): string => {
  const repoDir = mkdtempSync(join(tmpdir(), 'flowatlas-cfn-parameters-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repoDir, path)), { recursive: true });
    writeFileSync(join(repoDir, path), text);
  }
  return repoDir;
};

const read = (files: Record<string, string>, infra?: { vars?: string[]; options?: Record<string, string> }): Deployment => {
  const repoDir = repository(files);
  return cloudFormationReader.read({ repoDir, config: parseConfig({}), service: { name: 'svc', repo: repoDir, type: 'lambda', ...(infra === undefined ? {} : { infra: { vars: infra.vars ?? [], ...(infra.options === undefined ? {} : { options: infra.options }) } }) } });
};

/** A plain template of the resources given, with a parameter `Stage` and a function named by it. */
const template = (resources: string, parameters = ''): string =>
  [
    "AWSTemplateFormatVersion: '2010-09-09'",
    'Parameters:',
    '  Stage:',
    '    Type: String',
    '    Default: dev',
    ...parameters.split('\n').filter((line) => line !== '').map((line) => `  ${line}`),
    'Resources:',
    '  Fn:',
    '    Type: AWS::Lambda::Function',
    '    Properties:',
    '      FunctionName: !Sub shop-${Stage}-fn',
    '      Runtime: nodejs20.x',
    '      Handler: fn.handler',
    '      Code: src',
    ...resources.split('\n').filter((line) => line !== '').map((line) => `  ${line}`),
  ].join('\n');

const names = (deployment: Deployment): (string | undefined)[] => deployment.functions.map((fn) => fn.name);

describe('values a template reads from parameters of the account (P253)', () => {
  it('reads {{resolve:ssm:...}} and a parameter typed AWS::SSM::Parameter::Value as the parameter they name', () => {
    const deployment = read({
      'stack.yaml': template(
        [
          'ByReference:',
          '  Type: AWS::SNS::Subscription',
          '  Properties: { TopicArn: !Ref Topic, Protocol: sqs, Endpoint: x }',
        ].join('\n'),
        ['Topic:', '  Type: AWS::SSM::Parameter::Value<String>', '  Default: /shop/topic'].join('\n'),
      ).replace(
        '      Code: src',
        "      Code: src\n      Environment:\n        Variables:\n          TOPIC: !Ref Topic\n          QUEUE: '{{resolve:ssm:/shop/queue:2}}'\n          SECRET: '{{resolve:secretsmanager:shop}}'",
      ),
    });
    const environment = deployment.functions[0]?.environment ?? {};
    expect(environment['TOPIC']?.imported).toBe('parameter:/shop/topic');
    expect(environment['QUEUE']?.imported).toBe('parameter:/shop/queue');
    expect(environment['SECRET']?.imported).toBeUndefined();
  });

  it('reads a parameter another template of the repository writes as what it holds', () => {
    const deployment = read({
      'storage.yaml': "AWSTemplateFormatVersion: '2010-09-09'\nResources:\n  Queue:\n    Type: AWS::SQS::Queue\n    Properties: { QueueName: shop-jobs }\n  Param:\n    Type: AWS::SSM::Parameter\n    Properties: { Name: /shop/jobs, Type: String, Value: !GetAtt Queue.Arn }\n",
      'worker.yaml': template("Map:\n  Type: AWS::Lambda::EventSourceMapping\n  Properties: { EventSourceArn: '{{resolve:ssm:/shop/jobs}}', FunctionName: !Ref Fn }"),
    });
    expect(deployment.deliveries.map((delivery) => delivery.from)).toEqual([{ kind: 'queue', name: 'shop-jobs' }]);
    expect(deployment.imports ?? []).toEqual([]);
    expect(deployment.exports).toEqual([expect.objectContaining({ keys: ['parameter:/shop/jobs'], names: { kind: 'queue', name: 'shop-jobs' } })]);
  });

  it('reads an imported destination as each kind it may be, and a mapping of a parameter with a starting position as a stream or a table', () => {
    const deployment = read({
      'stack.yaml': template(
        [
          'Failures:',
          '  Type: AWS::Lambda::EventInvokeConfig',
          '  Properties:',
          '    FunctionName: !Ref Fn',
          '    Qualifier: $LATEST',
          '    DestinationConfig: { OnFailure: { Destination: !ImportValue shop-failures } }',
          'Changes:',
          '  Type: AWS::Lambda::EventSourceMapping',
          "  Properties: { EventSourceArn: '{{resolve:ssm:/shop/stream}}', FunctionName: !Ref Fn, StartingPosition: LATEST }",
        ].join('\n'),
      ),
    });
    const failures = 'stack.Resources.Failures.DestinationConfig.OnFailure';
    expect(deployment.deliveries.map((delivery) => delivery.address)).toEqual([
      ...['queue', 'topic', 'bus', 'function'].map((kind) => alternativeAddress(failures, kind)),
      ...['stream', 'table'].map((kind) => alternativeAddress('stack.Resources.Changes', kind)),
    ]);
    expect(deployment.imports?.map((site) => [site.key, site.alternatives?.map((alternative) => alternative.kind)])).toEqual([
      ['export:shop-failures', ['queue', 'topic', 'bus', 'function']],
      ['parameter:/shop/stream', ['stream', 'table']],
    ]);
  });

  it('hangs a resource from the root of an API another deployment writes to a parameter', () => {
    const deployment = read({
      'stack.yaml': template(
        [
          'Orders:',
          '  Type: AWS::ApiGateway::Resource',
          "  Properties: { RestApiId: '{{resolve:ssm:/shop/api/id}}', ParentId: '{{resolve:ssm:/shop/api/root}}', PathPart: orders }",
          'Post:',
          '  Type: AWS::ApiGateway::Method',
          '  Properties:',
          "    RestApiId: '{{resolve:ssm:/shop/api/id}}'",
          '    ResourceId: !Ref Orders',
          '    HttpMethod: POST',
          '    AuthorizationType: NONE',
          '    Integration: { Type: AWS_PROXY, IntegrationHttpMethod: POST, Uri: !Sub "arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Fn.Arn}/invocations" }',
        ].join('\n'),
      ),
    });
    expect(deployment.routes.map((route) => [route.method, route.root])).toEqual([['POST', { key: 'parameter:/shop/api/root', below: '/orders' }]]);
  });

  it('publishes a parameter whose value is a point of an API as that point', () => {
    const deployment = read({
      'api.yaml': "AWSTemplateFormatVersion: '2010-09-09'\nResources:\n  Api:\n    Type: AWS::ApiGateway::RestApi\n    Properties: { Name: shop }\n  Root:\n    Type: AWS::SSM::Parameter\n    Properties: { Name: /shop/api/root, Type: String, Value: !GetAtt Api.RootResourceId }\n",
    });
    expect(deployment.roots).toEqual([expect.objectContaining({ key: 'parameter:/shop/api/root', path: '/', api: 'shop' })]);
  });
});

describe('the files a template is deployed with (P253)', () => {
  it('reads the three ways a parameter file is written', () => {
    expect(parameterValues([{ ParameterKey: 'Stage', ParameterValue: 'prod' }, { ParameterKey: 'Old', UsePreviousValue: true }])).toEqual({ Stage: 'prod' });
    expect(parameterValues(['Stage=prod', 'Zones=a,b'])).toEqual({ Stage: 'prod', Zones: 'a,b' });
    expect(parameterValues({ Parameters: { Stage: 'prod', Size: 3 }, Tags: { team: 'shop' } })).toEqual({ Stage: 'prod', Size: '3' });
    expect(parameterValues({ Stage: 'prod' })).toBeUndefined();
  });

  it('reads the one beside a template under its name, and below the options', () => {
    const files = { 'stacks/orders.yaml': template(''), 'stacks/orders.parameters.json': JSON.stringify([{ ParameterKey: 'Stage', ParameterValue: 'prod' }]) };
    expect(names(read(files))).toEqual(['shop-prod-fn']);
    expect(names(read(files, { options: { Stage: 'qa' } }))).toEqual(['shop-qa-fn']);
  });

  it('reads a file of the shared names only for a template alone in its directory', () => {
    const shared = JSON.stringify({ Parameters: { Stage: 'prod' } });
    expect(names(read({ 'stacks/orders.yaml': template(''), 'stacks/parameters.json': shared }))).toEqual(['shop-prod-fn']);
    expect(names(read({ 'stacks/orders.yaml': template(''), 'stacks/other.yaml': template('').replace('-fn', '-other'), 'stacks/parameters.json': shared }))).toEqual(['shop-dev-fn', 'shop-dev-other']);
  });

  it('reads none of two beside one template, and says so', () => {
    const deployment = read({
      'orders.yaml': template(''),
      'orders.parameters.json': JSON.stringify(['Stage=prod']),
      'orders-config.json': JSON.stringify({ Parameters: { Stage: 'qa' } }),
    });
    expect(names(deployment)).toEqual(['shop-dev-fn']);
    expect(deployment.rows).toEqual([expect.objectContaining({ reason: 'parameter-file-ambiguous', file: 'orders.yaml' })]);
  });

  it('reads the one the configuration or samconfig names in place of those beside it', () => {
    const files = {
      'orders.yaml': template(''),
      'orders.parameters.json': JSON.stringify(['Stage=prod']),
      'orders-config.json': JSON.stringify({ Parameters: { Stage: 'qa' } }),
      'env/live.json': JSON.stringify(['Stage=live']),
    };
    expect(names(read(files, { vars: ['env/live.json'] }))).toEqual(['shop-live-fn']);
    const named = read({ ...files, 'samconfig.toml': 'version = 0.1\n[default.deploy.parameters]\ntemplate_file = "orders.yaml"\nparameter_overrides = "file://env/live.json"\n' });
    expect(names(named)).toEqual(['shop-live-fn']);
    expect(named.rows).toEqual([]);
  });
});
