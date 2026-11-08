import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { importedName, parseConfig, UNREAD_SPAN, type Deployment } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { cdkReader } from './index.js';

/** One stack, `shop-orders`, of one constructor body, with the imports the tests use. */
const stack = (body: string): Deployment => {
  const repoDir = mkdtempSync(join(tmpdir(), 'flowatlas-cdk-exports-'));
  const files: Record<string, string> = {
    'cdk.json': JSON.stringify({ app: 'npx ts-node bin/app.ts' }),
    'bin/app.ts': "import { App } from 'aws-cdk-lib';\nimport { AppStack } from '../lib/stack';\nconst app = new App();\nnew AppStack(app, 'shop-orders');\n",
    'lib/stack.ts': [
      "import * as path from 'path';",
      "import { CfnOutput, Fn, Stack } from 'aws-cdk-lib';",
      "import * as apigw from 'aws-cdk-lib/aws-apigateway';",
      "import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';",
      "import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';",
      "import * as lambda from 'aws-cdk-lib/aws-lambda';",
      "import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';",
      "import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';",
      "import * as sqs from 'aws-cdk-lib/aws-sqs';",
      "import * as ssm from 'aws-cdk-lib/aws-ssm';",
      "import { Construct } from 'constructs';",
      'export class AppStack extends Stack {',
      '  constructor(scope: Construct, id: string) {',
      '    super(scope, id);',
      "    const fn = (name: string, environment: Record<string, string> = {}) => new NodejsFunction(this, name, { functionName: name, entry: path.join(__dirname, '..', 'src', `${name}.ts`), runtime: lambda.Runtime.NODEJS_20_X, environment });",
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

describe('an app that publishes and reads values of other stacks (P249)', () => {
  it('hangs the methods of a REST API it looks up from the root it is looked up with, and the routes of an HTTP API from its id', () => {
    const deployment = stack(
      [
        "    const api = apigw.RestApi.fromRestApiAttributes(this, 'Shop', { restApiId: Fn.importValue('shop-api-id'), rootResourceId: Fn.importValue('shop-api-root') });",
        "    const orders = api.root.addResource('orders');",
        "    orders.addMethod('POST', new apigw.LambdaIntegration(fn('place')));",
        "    const http = apigwv2.HttpApi.fromHttpApiAttributes(this, 'Http', { httpApiId: Fn.importValue('shop-http-id') });",
        "    new apigwv2.HttpRoute(this, 'List', { httpApi: http, routeKey: apigwv2.HttpRouteKey.with('/orders', apigwv2.HttpMethod.GET), integration: new HttpLambdaIntegration('ListIntegration', fn('list')) });",
        "    const unread = apigw.RestApi.fromRestApiId(this, 'Old', 'abc123');",
        "    unread.root.addResource('old').addMethod('GET', new apigw.LambdaIntegration(fn('old')));",
      ].join('\n'),
    );
    expect(deployment.routes.map((route) => [route.method, route.path, route.root, route.api])).toEqual([
      ['POST', `/${UNREAD_SPAN}/orders`, { key: 'export:shop-api-root', below: '/orders' }, undefined],
      ['GET', `/${UNREAD_SPAN}/orders`, { key: 'export:shop-http-id', below: '/orders' }, undefined],
    ]);
    expect(deployment.rows.find((row) => row.reason === 'route-path-unread')?.message).toContain('shop-orders/Old is an API another stack creates');
  });

  it('names a queue looked up by an import by its stand-in, and a value of the environment by its key', () => {
    const deployment = stack(
      [
        "    const placed = sqs.Queue.fromQueueArn(this, 'Placed', Fn.importValue('orders-placed-arn'));",
        "    const audit = fn('audit', { SHOP_API_URL: Fn.importValue('shop-api-url'), PLACED_URL: placed.queueUrl });",
        '    audit.addEventSource(new SqsEventSource(placed));',
      ].join('\n'),
    );
    const name = importedName('export:orders-placed-arn');
    expect(deployment.deliveries.map((delivery) => delivery.from)).toContainEqual({ kind: 'queue', name });
    const environment = deployment.functions[0]?.environment ?? {};
    expect(environment['SHOP_API_URL']).toMatchObject({ imported: 'export:shop-api-url', written: 'Fn.importValue("shop-api-url")' });
    expect(environment['PLACED_URL']).toMatchObject({ names: { kind: 'queue', name } });
    expect(deployment.imports?.map((site) => [site.key, site.kinds])).toEqual([
      ['export:orders-placed-arn', ['queue']],
      ['export:shop-api-url', undefined],
    ]);
  });

  it('publishes an output by its export name, and by its stack where it is a direct child of one', () => {
    const deployment = stack(
      [
        "    const queue = new sqs.Queue(this, 'Placed', { queueName: 'orders-placed' });",
        "    const api = new apigw.RestApi(this, 'Api', { restApiName: 'shop' });",
        "    api.root.addResource('v1').addMethod('GET', new apigw.LambdaIntegration(fn('version')));",
        "    new CfnOutput(this, 'PlacedArn', { value: queue.queueArn, exportName: 'orders-placed-arn' });",
        "    new CfnOutput(this, 'ApiId', { value: api.restApiId });",
        "    new CfnOutput(this, 'ApiUrl', { value: api.url, exportName: 'shop-api-url' });",
        "    const group = new Construct(this, 'Group');",
        "    new CfnOutput(group, 'Deep', { value: 'text', exportName: 'deep-text' });",
      ].join('\n'),
    );
    const exports = Object.fromEntries((deployment.exports ?? []).map((value) => [value.address, value]));
    expect(exports['shop-orders/PlacedArn']).toMatchObject({ keys: ['export:orders-placed-arn', 'stack:shop-orders#PlacedArn'], names: { kind: 'queue', name: 'orders-placed' } });
    expect(exports['shop-orders/ApiId']).toMatchObject({ keys: ['stack:shop-orders#ApiId'], names: { kind: 'api', name: 'shop' } });
    expect(exports['shop-orders/ApiUrl']).toMatchObject({ keys: ['export:shop-api-url', 'stack:shop-orders#ApiUrl'], names: { kind: 'api', name: 'shop' } });
    // Below a construct of its own, the CDK hashes the output's logical id.
    expect(exports['shop-orders/Group/Deep']).toMatchObject({ keys: ['export:deep-text'], text: 'text' });
    expect(deployment.roots.map((root) => [root.key, root.path, root.api])).toEqual([['stack:shop-orders#ApiId', '/', 'shop']]);
  });
});

describe('values of other deployments written into one string (P261)', () => {
  it('reads each part of a name built in a template, Fn.sub, Fn.join or a +, and leaves the account aside', () => {
    const deployment = stack(
      [
        "    const prefix = Fn.importValue('shop-prefix');",
        "    const stage = ssm.StringParameter.valueForStringParameter(this, '/shop/stage');",
        "    const audit = sqs.Queue.fromQueueArn(this, 'Audit', `arn:aws:sqs:${this.region}:${Fn.importValue('shop-account')}:${prefix}-${stage}-audit`);",
        "    fn('audit').addEventSource(new SqsEventSource(audit));",
        '    fn(\'notify\', {',
        "      JOBS_URL: Fn.sub('https://sqs.${AWS::Region}.amazonaws.com/${AWS::AccountId}/${Prefix}-jobs', { Prefix: prefix }),",
        "      ALERTS_ARN: Fn.join(':', ['arn:aws:sns:eu-west-1:111122223333', Fn.importValue('shop-alerts')]),",
        "      REPORTS_URL: 'https://sqs.eu-west-1.amazonaws.com/111122223333/' + prefix + '-' + stage + '-reports',",
        '    });',
      ].join('\n'),
    );
    const built = `${importedName('export:shop-prefix')}-${importedName('parameter:/shop/stage')}-audit`;
    expect(deployment.deliveries.map((delivery) => delivery.from)).toContainEqual({ kind: 'queue', name: built });
    const environment = deployment.functions.find((one) => one.name === 'notify')?.environment ?? {};
    expect(environment['JOBS_URL']?.names).toEqual({ kind: 'queue', name: `${importedName('export:shop-prefix')}-jobs` });
    expect(environment['ALERTS_ARN']?.names).toEqual({ kind: 'topic', name: importedName('export:shop-alerts') });
    expect(environment['REPORTS_URL']?.names).toEqual({ kind: 'queue', name: `${importedName('export:shop-prefix')}-${importedName('parameter:/shop/stage')}-reports` });
    // The account is aside: `shop-account` is imported nowhere.
    expect(deployment.imports?.map((site) => `${site.key} ${site.as} ${site.within === undefined ? '-' : site.within.replace(/\$\{…\}@import\./g, '~')}`).sort()).toEqual([
      'export:shop-alerts name -',
      'export:shop-prefix name ~export.shop-prefix-jobs',
      'export:shop-prefix name ~export.shop-prefix-~parameter..shop.stage-audit',
      'export:shop-prefix name ~export.shop-prefix-~parameter..shop.stage-reports',
      'parameter:/shop/stage name ~export.shop-prefix-~parameter..shop.stage-audit',
      'parameter:/shop/stage name ~export.shop-prefix-~parameter..shop.stage-reports',
    ]);
  });
});
