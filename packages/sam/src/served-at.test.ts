import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseConfig, type Deployment } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { samReader } from './index.js';

const read = (files: Record<string, string>, options?: Record<string, string>): Deployment => {
  const repoDir = mkdtempSync(join(tmpdir(), 'flowatlas-sam-served-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repoDir, path)), { recursive: true });
    writeFileSync(join(repoDir, path), text);
  }
  return samReader.read({
    repoDir,
    config: parseConfig({}),
    service: { name: 'svc', repo: repoDir, type: 'lambda', ...(options === undefined ? {} : { infra: { vars: [], options } }) },
  });
};

const template = (resources: string, head = ''): string => `Transform: AWS::Serverless-2016-10-31\n${head}Resources:\n${resources.replace(/^/gm, '  ')}\n`;

const fn = (events: string): string =>
  ['Place:', '  Type: AWS::Serverless::Function', '  Properties:', '    Handler: src/place.handler', '    Runtime: nodejs20.x', `    Events: ${events}`].join('\n');

const servedOf = (deployment: Deployment): unknown[] => deployment.routes.map((route) => [route.method, route.path, route.meta?.['servedAt']]);

const HOST = '*.execute-api.eu-west-1.amazonaws.com';
const OPEN_HOST = '*.execute-api.*.amazonaws.com';
const SAMCONFIG = { 'samconfig.toml': 'version = 0.1\n[default.deploy.parameters]\nstack_name = "shop"\nregion = "eu-west-1"\n' };

describe('where a SAM or CloudFormation API is served (P294)', () => {
  it('serves the APIs the transform makes in the samconfig region: Prod for REST, the root for HTTP', () => {
    const deployment = read({
      ...SAMCONFIG,
      'template.yaml': template(fn('{ Rest: { Type: Api, Properties: { Path: /orders, Method: post } }, Http: { Type: HttpApi, Properties: { Path: /orders, Method: get } } }')),
    });
    expect(servedOf(deployment)).toEqual([
      ['POST', '/orders', [{ host: HOST, base: ['Prod'], api: 'shop' }]],
      ['GET', '/orders', [{ host: HOST, base: [], api: 'shop' }]],
    ]);
  });

  it('leaves the region open where nothing states it, and the stage open where a parameter names it', () => {
    const deployment = read({
      'template.yaml': template(
        [
          'Api:',
          '  Type: AWS::Serverless::Api',
          '  Properties: { Name: shop-api, StageName: !Ref Stage }',
          fn('{ Rest: { Type: Api, Properties: { RestApiId: !Ref Api, Path: /orders, Method: post } } }'),
        ].join('\n'),
        'Parameters:\n  Stage: { Type: String, Default: dev }\n',
      ),
    });
    expect(servedOf(deployment)).toEqual([['POST', '/orders', [{ host: OPEN_HOST, base: ['*'], api: 'shop-api', chosenDefault: 'dev' }]]]);
    // The configuration's options settle the parameter: that stage.
    const settled = read(
      {
        'template.yaml': template(
          ['Api:', '  Type: AWS::Serverless::Api', '  Properties: { Name: shop-api, StageName: !Ref Stage }', fn('{ Rest: { Type: Api, Properties: { RestApiId: !Ref Api, Path: /orders, Method: post } } }')].join('\n'),
          'Parameters:\n  Stage: { Type: String, Default: dev }\n',
        ),
      },
      { Stage: 'qa' },
    );
    expect(servedOf(settled)[0]).toEqual(['POST', '/orders', [{ host: OPEN_HOST, base: ['qa'], api: 'shop-api' }]]);
  });

  it('serves a REST API written as resources once per stage, an HTTP API with a quick-create target at the root', () => {
    const deployment = read({
      ...SAMCONFIG,
      'template.yaml': template(
        [
          'Rest: { Type: AWS::ApiGateway::RestApi, Properties: { Name: shop-rest } }',
          'Orders: { Type: AWS::ApiGateway::Resource, Properties: { RestApiId: !Ref Rest, ParentId: !GetAtt Rest.RootResourceId, PathPart: orders } }',
          'Post:',
          '  Type: AWS::ApiGateway::Method',
          '  Properties:',
          '    RestApiId: !Ref Rest',
          '    ResourceId: !Ref Orders',
          '    HttpMethod: POST',
          '    Integration: { Type: AWS_PROXY, IntegrationHttpMethod: POST, Uri: !Sub "arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Place.Arn}/invocations" }',
          'Live: { Type: AWS::ApiGateway::Stage, Properties: { RestApiId: !Ref Rest, StageName: live } }',
          'Beta: { Type: AWS::ApiGateway::Stage, Properties: { RestApiId: !Ref Rest, StageName: beta } }',
          'Quick: { Type: AWS::ApiGatewayV2::Api, Properties: { Name: shop-quick, ProtocolType: HTTP, Target: !GetAtt Place.Arn } }',
          fn('[]'),
        ].join('\n'),
      ),
    });
    expect(servedOf(deployment)).toEqual([
      ['POST', '/orders', [{ host: HOST, base: ['live'], api: 'shop-rest' }, { host: HOST, base: ['beta'], api: 'shop-rest' }]],
      ['ALL', '/*', [{ host: HOST, base: [], api: 'shop-quick' }]],
    ]);
  });
});
