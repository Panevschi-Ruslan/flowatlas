import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { alternativeAddress, importedName, parseConfig, type Deployment } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { serverlessReader } from './index.js';
import { Imported, Unread, Variables } from './variables.js';

const read = (files: Record<string, string>): Deployment => {
  const repoDir = mkdtempSync(join(tmpdir(), 'flowatlas-serverless-parameters-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repoDir, path)), { recursive: true });
    writeFileSync(join(repoDir, path), text);
  }
  return serverlessReader.read({ repoDir, config: parseConfig({}), service: { name: 'svc', repo: repoDir, type: 'lambda' } });
};

const PROVIDER = 'service: shop\nprovider:\n  name: aws\n  runtime: nodejs20.x\n  stage: prod\n  region: eu-west-1\n';
const KEY = 'parameter:/shop/orders/queue';

describe('parameters of the account shared between deployments (P253)', () => {
  it('reads ${ssm:...} in each of its spellings as the parameter it names', () => {
    const variables = new Variables({ document: { a: '${ssm:/shop/orders/queue}', b: '${ssm(eu-west-1):/shop/orders/queue}', c: '${ssm:/shop/orders/queue~true}', d: '${ssm:}' }, dir: tmpdir(), options: {}, loaded: new Set() });
    for (const at of ['a', 'b', 'c']) expect((variables.at([at]) as Imported).key).toBe(KEY);
    expect(variables.at(['d'])).not.toBeInstanceOf(Imported);
  });

  it('carries an import written inside a string, with its stand-in in place, and not two', () => {
    const variables = new Variables({ document: { one: 'https://sqs.eu-west-1.amazonaws.com/1/${ssm:/shop/orders/queue}', two: '${ssm:/a}-${ssm:/b}' }, dir: tmpdir(), options: {}, loaded: new Set() });
    const one = variables.at(['one']) as Unread;
    expect(one).not.toBeInstanceOf(Imported);
    expect(one.embeds).toEqual({ key: KEY, text: `https://sqs.eu-west-1.amazonaws.com/1/${importedName(KEY)}` });
    expect((variables.at(['two']) as Unread).embeds).toBeUndefined();
  });

  it('names the queue an address built around an imported name is, and imports it as that name', () => {
    const deployment = read({
      'serverless.yml': `${PROVIDER}functions:\n  place:\n    handler: src/place.handler\n    environment:\n      QUEUE_URL: https://sqs.eu-west-1.amazonaws.com/1/\${ssm:/shop/orders/queue}\n      WHOLE: \${ssm:/shop/orders/queue}\n`,
    });
    const environment = deployment.functions[0]?.environment ?? {};
    expect(environment['QUEUE_URL']?.names).toEqual({ kind: 'queue', name: importedName(KEY) });
    expect(environment['WHOLE']?.imported).toBe(KEY);
    expect(deployment.imports).toEqual(expect.arrayContaining([expect.objectContaining({ key: KEY, kinds: ['queue'], as: 'name' }), expect.objectContaining({ key: KEY })]));
  });

  it('publishes a parameter the service writes under its name, and not one with no name', () => {
    const deployment = read({
      'serverless.yml': [
        PROVIDER,
        'resources:',
        '  Resources:',
        '    Queue:',
        '      Type: AWS::SQS::Queue',
        '      Properties: { QueueName: shop-orders }',
        '    Named:',
        '      Type: AWS::SSM::Parameter',
        '      Properties: { Name: /shop/orders/queue, Type: String, Value: !GetAtt Queue.Arn }',
        '    Text:',
        '      Type: AWS::SSM::Parameter',
        '      Properties: { Name: /shop/mode, Type: String, Value: live }',
        '    Unnamed:',
        '      Type: AWS::SSM::Parameter',
        '      Properties: { Type: String, Value: !GetAtt Queue.Arn }',
      ].join('\n'),
    });
    expect(deployment.exports).toEqual([
      expect.objectContaining({ keys: [KEY], names: { kind: 'queue', name: 'shop-orders' } }),
      expect.objectContaining({ keys: ['parameter:/shop/mode'], text: 'live' }),
    ]);
  });

  it('reads a destination of an import as each kind it may be, unless the framework is told which', () => {
    const deployment = read({
      'serverless.yml': `${PROVIDER}functions:\n  place:\n    handler: src/place.handler\n    destinations:\n      onFailure: \${ssm:/shop/failures}\n      onSuccess:\n        type: sqs\n        arn: \${ssm:/shop/done}\n`,
    });
    const failure = 'functions.place.destinations.onFailure';
    expect(deployment.deliveries.map((delivery) => [delivery.address, delivery.to])).toEqual([
      ['functions.place.destinations.onSuccess', { kind: 'queue', name: importedName('parameter:/shop/done') }],
      [alternativeAddress(failure, 'queue'), { kind: 'queue', name: importedName('parameter:/shop/failures') }],
      [alternativeAddress(failure, 'topic'), { kind: 'topic', name: importedName('parameter:/shop/failures') }],
      [alternativeAddress(failure, 'bus'), expect.objectContaining({ kind: 'bus', name: importedName('parameter:/shop/failures') })],
      [alternativeAddress(failure, 'function'), { kind: 'function', name: importedName('parameter:/shop/failures') }],
    ]);
    expect(deployment.imports?.find((site) => site.key === 'parameter:/shop/failures')?.alternatives?.map((alternative) => alternative.kind)).toEqual(['queue', 'topic', 'bus', 'function']);
  });

  it('hangs the routes of a shared REST API from the root resource it is given, else from the API', () => {
    const routes = (gateway: string) =>
      read({ 'serverless.yml': `${PROVIDER}  apiGateway:\n${gateway}functions:\n  place:\n    handler: src/place.handler\n    events:\n      - http: POST orders\n` }).routes.map((route) => route.root);
    expect(routes('    restApiId: ${ssm:/shop/api/id}\n    restApiRootResourceId: ${ssm:/shop/api/root}\n')).toEqual([{ key: 'parameter:/shop/api/root', below: '/orders' }]);
    expect(routes('    restApiId: ${ssm:/shop/api/id}\n')).toEqual([{ key: 'parameter:/shop/api/id', below: '/orders' }]);
  });

  it('reads a mapping of {{resolve:ssm:...}} as a queue without a starting position, and as a stream or a table with one', () => {
    const deployment = read({
      'serverless.yml': [
        PROVIDER,
        'functions:',
        '  index:',
        '    handler: src/index.handler',
        'resources:',
        '  Resources:',
        '    Queued:',
        '      Type: AWS::Lambda::EventSourceMapping',
        "      Properties: { EventSourceArn: '{{resolve:ssm:/shop/queue}}', FunctionName: !Ref IndexLambdaFunction }",
        '    Streamed:',
        '      Type: AWS::Lambda::EventSourceMapping',
        "      Properties: { EventSourceArn: '{{resolve:ssm:/shop/stream:3}}', FunctionName: !Ref IndexLambdaFunction, StartingPosition: LATEST }",
      ].join('\n'),
    });
    expect(deployment.deliveries.map((delivery) => [delivery.address, delivery.from])).toEqual([
      ['resources.Resources.Queued', { kind: 'queue', name: importedName('parameter:/shop/queue') }],
      [alternativeAddress('resources.Resources.Streamed', 'stream'), { kind: 'changes', of: 'stream', name: importedName('parameter:/shop/stream') }],
      [alternativeAddress('resources.Resources.Streamed', 'table'), { kind: 'changes', of: 'table', name: importedName('parameter:/shop/stream') }],
    ]);
  });
});
