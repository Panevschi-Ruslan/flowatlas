import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseConfig, type Deployment } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { cdkReader } from './index.js';

/** Where the APIs a CDK app creates are served (P294). */
const stack = (body: string, props = ''): Deployment => {
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
  return cdkReader.read({ repoDir, config: parseConfig({}), service: { name: 'app', repo: repoDir, type: 'lambda' } });
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
