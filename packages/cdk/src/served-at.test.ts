import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseConfig, type Deployment } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { cdkReader } from './index.js';

/** Where the APIs a CDK app creates are served (P294). */
const stack = (body: string, props = '', options?: Record<string, string>): Deployment => {
  const repoDir = mkdtempSync(join(tmpdir(), 'flowatlas-cdk-served-'));
  const files: Record<string, string> = {
    'cdk.json': JSON.stringify({ app: 'npx ts-node bin/app.ts' }),
    'bin/app.ts': `import { App } from 'aws-cdk-lib';\nimport { AppStack } from '../lib/stack';\nconst app = new App();\nnew AppStack(app, 'App'${props});\n`,
    'lib/stack.ts': [
      "import * as path from 'path';",
      "import * as cdk from 'aws-cdk-lib';",
      "import { aws_lambda as lambda, aws_apigateway as apigw } from 'aws-cdk-lib';",
      "import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';",
      "import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';",
      "import { Construct } from 'constructs';",
      'export class AppStack extends cdk.Stack {',
      '  constructor(scope: Construct, id: string, props?: cdk.StackProps) {',
      '    super(scope, id, props);',
      "    const place = new lambda.Function(this, 'Place', { functionName: 'shop-place', runtime: lambda.Runtime.NODEJS_20_X, code: lambda.Code.fromAsset(path.join(__dirname, '..', 'src')), handler: 'place.handler' });",
      body,
      '  }',
      '}',
    ].join('\n'),
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repoDir, path)), { recursive: true });
    writeFileSync(join(repoDir, path), text);
  }
  return cdkReader.read({ repoDir, config: parseConfig({}), service: { name: 'app', repo: repoDir, type: 'lambda', ...(options === undefined ? {} : { infra: { vars: [], options } }) } });
};

const servedOf = (deployment: Deployment): unknown[] => deployment.routes.map((route) => [route.method, route.path, route.meta?.['servedAt']]);

describe('where a CDK API is served (P294)', () => {
  it("serves a REST API at its deployOptions stage, prod where none is written, in its stack's region", () => {
    const deployment = stack(
      `const api = new apigw.RestApi(this, 'Api', { restApiName: 'shop-api', deployOptions: { stageName: 'live' } });
    api.root.addResource('orders').addMethod('POST', new apigw.LambdaIntegration(place));
    const plain = new apigw.RestApi(this, 'Plain', { restApiName: 'shop-plain' });
    plain.root.addResource('stock').addMethod('GET', new apigw.LambdaIntegration(place));`,
      ", { env: { region: 'eu-west-1' } }",
    );
    expect(servedOf(deployment)).toEqual([
      ['POST', '/orders', [{ host: '*.execute-api.eu-west-1.amazonaws.com', base: ['live'], api: 'shop-api' }]],
      ['GET', '/stock', [{ host: '*.execute-api.eu-west-1.amazonaws.com', base: ['prod'], api: 'shop-plain' }]],
    ]);
  });

  it('serves an HTTP API at the root of its default stage and under every stage it is given, any region where none is written', () => {
    const deployment = stack(`const api = new apigwv2.HttpApi(this, 'Http', { apiName: 'shop-http' });
    api.addRoutes({ path: '/orders', methods: [apigwv2.HttpMethod.GET], integration: new HttpLambdaIntegration('Place', place) });
    api.addStage('Beta', { stageName: 'beta' });
    const bare = new apigwv2.HttpApi(this, 'Bare', { apiName: 'shop-bare', createDefaultStage: false });
    bare.addRoutes({ path: '/stock', methods: [apigwv2.HttpMethod.GET], integration: new HttpLambdaIntegration('Stock', place) });`);
    expect(servedOf(deployment)).toEqual([
      [
        'GET',
        '/orders',
        [
          { host: '*.execute-api.*.amazonaws.com', base: [], api: 'shop-http' },
          { host: '*.execute-api.*.amazonaws.com', base: ['beta'], api: 'shop-http' },
        ],
      ],
      ['GET', '/stock', [{ host: '*.execute-api.*.amazonaws.com', base: ['*'], api: 'shop-bare' }]],
    ]);
  });
});

describe('a stage and a region the app takes from its context (P298)', () => {
  const body = `const stage = this.node.tryGetContext('stage') ?? 'beta';
    const api = new apigw.RestApi(this, 'Api', { restApiName: 'shop-api', deployOptions: { stageName: stage } });
    api.root.addResource('orders').addMethod('POST', new apigw.LambdaIntegration(place));`;
  const props = ", { env: { region: app.node.tryGetContext('region') ?? 'eu-west-1' } }";

  it('is any stage and any region `-c` names, the ones the app falls back to where none is given', () => {
    expect(servedOf(stack(body, props))).toEqual([
      ['POST', '/orders', [{ host: '*.execute-api.*.amazonaws.com', base: ['*'], api: 'shop-api', chosenDefault: 'beta', chosenHost: '*.execute-api.eu-west-1.amazonaws.com' }]],
    ]);
  });

  it('is the stage and the region the configured options fix', () => {
    expect(servedOf(stack(body, props, { stage: 'qa', region: 'us-east-2' }))).toEqual([
      ['POST', '/orders', [{ host: '*.execute-api.us-east-2.amazonaws.com', base: ['qa'], api: 'shop-api' }]],
    ]);
  });
});

describe('a context value handed on as an argument or kept in a field (P304)', () => {
  const open = [['POST', '/orders', [{ host: '*.execute-api.eu-west-1.amazonaws.com', base: ['*'], api: 'shop-api', chosenDefault: 'beta' }]]];
  const region = ", { env: { region: 'eu-west-1' } }";

  it('stays chosen handed to a function of the app as a bare argument, its default too', () => {
    const body = `const ctx = this.node.tryGetContext('stage');
    const makeApi = (scope: Construct, stage: string = 'beta') => new apigw.RestApi(scope, 'Api', { restApiName: 'shop-api', deployOptions: { stageName: stage } });
    const api = makeApi(this, ctx);
    api.root.addResource('orders').addMethod('POST', new apigw.LambdaIntegration(place));`;
    expect(servedOf(stack(body, region))).toEqual(open);
  });

  it('stays chosen kept in a field of the construct and read in another method', () => {
    const body = `this.stage = this.node.tryGetContext('stage') ?? 'beta';
    this.addApi();
  }
  stage: string;
  addApi() {
    const api = new apigw.RestApi(this, 'Api', { restApiName: 'shop-api', deployOptions: { stageName: this.stage } });
    api.root.addResource('orders').addMethod('POST', new apigw.LambdaIntegration(place));`;
    expect(servedOf(stack(body, region))).toEqual(open);
  });

  it("stays chosen handed to a construct of the app's own and destructured out of its props", () => {
    const body = `new Orders(this, 'Orders', { stage: this.node.tryGetContext('stage') ?? 'beta' });
  }
}
class Orders extends Construct {
  constructor(scope: Construct, id: string, { stage }: { stage: string }) {
    super(scope, id);
    const fn = new lambda.Function(this, 'Place', { functionName: 'shop-orders', runtime: lambda.Runtime.NODEJS_20_X, code: lambda.Code.fromAsset('src'), handler: 'place.handler' });
    const api = new apigw.RestApi(this, 'Api', { restApiName: 'shop-api', deployOptions: { stageName: stage } });
    api.root.addResource('orders').addMethod('POST', new apigw.LambdaIntegration(fn));`;
    expect(servedOf(stack(body, region))).toEqual(open);
  });

  it('is the plain value where the configured options fix it', () => {
    const body = `this.stage = this.node.tryGetContext('stage') ?? 'beta';
    this.addApi();
  }
  stage: string;
  addApi() {
    const api = new apigw.RestApi(this, 'Api', { restApiName: 'shop-api', deployOptions: { stageName: this.stage } });
    api.root.addResource('orders').addMethod('POST', new apigw.LambdaIntegration(place));`;
    expect(servedOf(stack(body, region, { stage: 'qa' }))).toEqual([
      ['POST', '/orders', [{ host: '*.execute-api.eu-west-1.amazonaws.com', base: ['qa'], api: 'shop-api' }]],
    ]);
  });
});
