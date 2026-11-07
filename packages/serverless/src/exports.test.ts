import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { importedName, parseConfig, UNREAD_SPAN, type Deployment } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { composeFiles, serverlessReader } from './index.js';
import { Imported, Variables } from './variables.js';

/** A repository of the files given, read as the Serverless Framework reader reads it. */
const repository = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'flowatlas-serverless-exports-'));
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

const PROVIDER = 'provider:\n  name: aws\n  runtime: nodejs20.x\n  stage: prod\n';

describe('values another stack publishes (P249)', () => {
  it('reads ${cf:stack.Output} and ${cf(region):stack.Output} as outputs of a stack, by its name and theirs', () => {
    const variables = new Variables({ document: { a: '${cf:orders-prod.QueueUrl}', b: '${cf(eu-west-1):orders-prod.QueueArn}', c: '${cf:nothing}' }, dir: tmpdir(), options: {}, loaded: new Set() });
    expect(variables.at(['a'])).toBeInstanceOf(Imported);
    expect((variables.at(['a']) as Imported).key).toBe('stack:orders-prod#QueueUrl');
    expect((variables.at(['b']) as Imported).key).toBe('stack:orders-prod#QueueArn');
    expect(variables.at(['c'])).not.toBeInstanceOf(Imported);
  });

  it('names a queue, a topic and a bus another stack exports by their stand-ins, and every value of the environment by its key', () => {
    const deployment = read({
      'serverless.yml': `service: shop\n${PROVIDER}functions:\n  ship:\n    handler: src/ship.handler\n    environment:\n      QUEUE_URL: \${cf:orders-prod.QueueUrl}\n      TOPIC_ARN: !ImportValue orders-topic-arn\n    events:\n      - sqs:\n          arn: \${cf:orders-prod.QueueArn}\n      - sns:\n          arn: !ImportValue orders-topic-arn\n      - eventBridge:\n          eventBus: !ImportValue orders-bus-arn\n          pattern:\n            source: [orders]\n`,
    });
    const sources = deployment.deliveries.map((delivery) => delivery.from);
    expect(sources).toContainEqual({ kind: 'queue', name: importedName('stack:orders-prod#QueueArn') });
    expect(sources).toContainEqual({ kind: 'topic', name: importedName('export:orders-topic-arn') });
    expect(sources.find((source) => source.kind === 'bus')).toMatchObject({ name: importedName('export:orders-bus-arn') });
    const environment = deployment.functions[0]?.environment ?? {};
    expect(environment['QUEUE_URL']).toMatchObject({ imported: 'stack:orders-prod#QueueUrl' });
    expect(environment['TOPIC_ARN']).toMatchObject({ imported: 'export:orders-topic-arn', written: '!ImportValue orders-topic-arn' });
    expect(deployment.imports?.map((site) => [site.key, site.kinds])).toEqual([
      ['stack:orders-prod#QueueUrl', undefined],
      ['export:orders-topic-arn', undefined],
      ['stack:orders-prod#QueueArn', ['queue']],
      ['export:orders-topic-arn', ['topic']],
      ['export:orders-bus-arn', ['bus']],
    ]);
    expect(deployment.rows.map((row) => row.reason)).not.toContain('subscription-source-unread');
  });

  it('publishes each output under its export name and its stack, and the API it names as a root', () => {
    const deployment = read({
      'serverless.yml': `service: gateway\n${PROVIDER}  apiName: shop\nfunctions:\n  health:\n    handler: src/health.handler\n    events:\n      - http: GET health\nresources:\n  Resources:\n    Queue:\n      Type: AWS::SQS::Queue\n      Properties:\n        QueueName: jobs\n  Outputs:\n    RestApiId:\n      Value: !Ref ApiGatewayRestApi\n      Export:\n        Name: shop-api-id\n    Url:\n      Value: !Sub https://\${ApiGatewayRestApi}.execute-api.eu-west-1.amazonaws.com/prod\n    QueueArn:\n      Value: !GetAtt Queue.Arn\n      Export:\n        Name: jobs-arn\n    Plain:\n      Value: hello\n`,
    });
    const exports = Object.fromEntries((deployment.exports ?? []).map((value) => [value.address, value]));
    expect(exports['resources.Outputs.RestApiId']).toMatchObject({ keys: ['export:shop-api-id', 'stack:gateway-prod#RestApiId'], names: { kind: 'api', name: 'shop' } });
    expect(exports['resources.Outputs.Url']).toMatchObject({ keys: ['stack:gateway-prod#Url'], names: { kind: 'api', name: 'shop' } });
    expect(exports['resources.Outputs.QueueArn']).toMatchObject({ names: { kind: 'queue', name: 'jobs' } });
    expect(exports['resources.Outputs.Plain']).toMatchObject({ text: 'hello' });
    // The framework's own: its REST API's address, exported as it exports it.
    expect(exports['Outputs.ServiceEndpoint']).toMatchObject({ keys: ['export:sls-gateway-prod-ServiceEndpoint', 'stack:gateway-prod#ServiceEndpoint'] });
    // The API's id is a point other stacks hang routes from; its URL is not.
    expect(deployment.roots.map((root) => [root.key, root.path, root.api])).toEqual([
      ['export:shop-api-id', '/', 'shop'],
      ['stack:gateway-prod#RestApiId', '/', 'shop'],
    ]);
  });

  it('hangs the routes of a service on a shared REST or HTTP API from the point the other stack exports', () => {
    const deployment = read({
      'serverless.yml': `service: orders\n${PROVIDER}  apiGateway:\n    restApiId: \${cf:gateway-prod.RestApiId}\n  httpApi:\n    id: !ImportValue shop-http-id\nfunctions:\n  place:\n    handler: src/place.handler\n    events:\n      - http: POST orders\n      - httpApi: GET /orders/{id}\n`,
    });
    expect(deployment.routes.map((route) => [route.method, route.path, route.root, route.api])).toEqual([
      ['POST', `/${UNREAD_SPAN}/orders`, { key: 'stack:gateway-prod#RestApiId', below: '/orders' }, undefined],
      ['GET', `/${UNREAD_SPAN}/orders/:param`, { key: 'export:shop-http-id', below: '/orders/:param' }, undefined],
    ]);
    // A service on another's API does not publish the framework's own outputs of it.
    expect(deployment.exports).toEqual([]);
  });

  it('draws no route on a shared API whose id is not an output another stack publishes, and says why', () => {
    const deployment = read({
      'serverless.yml': `service: orders\n${PROVIDER}  apiGateway:\n    restApiId: abc123\nfunctions:\n  place:\n    handler: src/place.handler\n    events:\n      - http: POST orders\n`,
    });
    expect(deployment.routes).toEqual([]);
    expect(deployment.rows.find((row) => row.reason === 'route-path-unread')?.message).toContain('abc123');
  });
});

describe('a serverless-compose.yml (P249)', () => {
  const files = {
    'serverless-compose.yml': 'services:\n  shared:\n    path: shared\n  api:\n    path: api\n    params:\n      queueUrl: ${shared.QueueUrl}\n      apiId: ${shared.RestApiId}\n      stage: ${sls:stage}\n      missing: ${nobody.Thing}\n  ghost:\n    path: ghost\n  empty:\n    path: empty\n  outside:\n    path: ../elsewhere\n',
    'shared/serverless.yml': `service: jobs-shared\nprovider:\n  name: aws\n  runtime: nodejs20.x\nfunctions:\n  work:\n    handler: src/work.handler\nresources:\n  Resources:\n    Queue:\n      Type: AWS::SQS::Queue\n      Properties:\n        QueueName: jobs\n  Outputs:\n    QueueUrl:\n      Value: !Ref Queue\n`,
    'api/serverless.yml': `service: jobs-api\nprovider:\n  name: aws\n  runtime: nodejs20.x\n  apiGateway:\n    restApiId: \${param:apiId}\n  environment:\n    STAGE: \${param:stage}\n    MISSING: \${param:missing}\nfunctions:\n  submit:\n    handler: src/submit.handler\n    environment:\n      QUEUE_URL: \${param:queueUrl}\n    events:\n      - http: POST jobs\n`,
    'empty/README.md': 'nothing here\n',
    'tools/serverless.yml': `service: jobs-tools\nprovider:\n  name: aws\n  runtime: nodejs20.x\nfunctions:\n  sweep:\n    handler: src/sweep.handler\n`,
  };

  it('reads the services it lists with its params, each output of another an import under that service stack', () => {
    const deployment = read(files);
    const byName = Object.fromEntries(deployment.functions.map((fn) => [fn.name, fn]));
    expect(Object.keys(byName).sort()).toEqual(['jobs-api-dev-submit', 'jobs-shared-dev-work', 'jobs-tools-dev-sweep']);
    expect(byName['jobs-api-dev-submit']?.meta?.['composedAs']).toBe('api');
    expect(byName['jobs-tools-dev-sweep']?.meta?.['composedAs']).toBeUndefined();
    const environment = byName['jobs-api-dev-submit']?.environment ?? {};
    expect(environment['QUEUE_URL']).toMatchObject({ imported: 'stack:jobs-shared-dev#QueueUrl' });
    expect(environment['STAGE']).toMatchObject({ text: 'dev' });
    expect(environment['MISSING']?.unread?.text).toContain('does not list');
    expect(deployment.routes[0]?.root).toEqual({ key: 'stack:jobs-shared-dev#RestApiId', below: '/jobs' });
    expect(deployment.exports?.find((value) => value.address === 'resources.Outputs.QueueUrl')?.keys).toEqual(['stack:jobs-shared-dev#QueueUrl']);
  });

  it('says which services it lists that are not read, and is found as service files are', () => {
    const deployment = read(files);
    expect(deployment.rows.filter((row) => row.reason === 'compose-service-unread').map((row) => row.message)).toEqual([
      'serverless-compose.yml lists the service ghost, whose folder ghost is not there, so nothing it declares is read',
      'serverless-compose.yml lists the service empty, whose folder empty holds no service file, so nothing it declares is read',
      'serverless-compose.yml lists the service outside, whose folder ../elsewhere is outside the repository, so nothing it declares is read',
    ]);
    expect(composeFiles(repository(files))).toEqual(['serverless-compose.yml']);
    expect(serverlessReader.files(repository(files))).toContain('serverless-compose.yml');
    const custom = repository({ 'serverless-compose.yml': 'services:\n  api:\n    path: api\n    config: api.yml\n', 'api/api.yml': 'service: jobs-api\nprovider:\n  name: aws\n' });
    expect(serverlessReader.files(custom)).toContain('api/api.yml');
  });
});
