import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { importedName, parseConfig, UNREAD_SPAN, type Deployment } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { samReader } from './index.js';

/** A repository of the files given, read as the SAM reader reads it. */
const read = (files: Record<string, string>): Deployment => {
  const repoDir = mkdtempSync(join(tmpdir(), 'flowatlas-sam-exports-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repoDir, path)), { recursive: true });
    writeFileSync(join(repoDir, path), text);
  }
  return samReader.read({ repoDir, config: parseConfig({}), service: { name: 'svc', repo: repoDir, type: 'lambda' } });
};

/** A template of the transform, its resources and outputs indented under their sections. */
const template = (resources: string, outputs = ''): string =>
  `Transform: AWS::Serverless-2016-10-31\nGlobals:\n  Function:\n    Runtime: nodejs20.x\n    CodeUri: src/\nResources:\n${resources.replace(/^/gm, '  ')}\n${outputs === '' ? '' : `Outputs:\n${outputs.replace(/^/gm, '  ')}\n`}`;

const SAMCONFIG = 'version = 0.1\n\n[default.deploy.parameters]\nstack_name = "catalog-prod"\n';

describe('a template that publishes and reads values of other stacks (P249)', () => {
  it('publishes its outputs under their export names and its stack, an API and a resource of it as points', () => {
    const deployment = read({
      'samconfig.toml': SAMCONFIG,
      'template.yaml': template(
        [
          'Api:',
          '  Type: AWS::Serverless::Api',
          '  Properties:',
          '    Name: shop',
          '    StageName: prod',
          'V1:',
          '  Type: AWS::ApiGateway::Resource',
          '  Properties:',
          '    RestApiId: !Ref Api',
          '    ParentId: !GetAtt Api.RootResourceId',
          '    PathPart: v1',
          'Topic:',
          '  Type: AWS::SNS::Topic',
          '  Properties:',
          '    TopicName: restock',
        ].join('\n'),
        [
          'ApiId:',
          '  Value: !Ref Api',
          '  Export:',
          '    Name: shop-api-id',
          'V1Id:',
          '  Value: !Ref V1',
          'Url:',
          '  Value: !Sub https://${Api}.execute-api.${AWS::Region}.amazonaws.com/prod',
          'TopicArn:',
          '  Value: !Ref Topic',
          '  Export:',
          '    Name: restock-arn',
        ].join('\n'),
      ),
    });
    const exports = Object.fromEntries((deployment.exports ?? []).map((value) => [value.address, value]));
    expect(exports['Outputs.ApiId']).toMatchObject({ keys: ['export:shop-api-id', 'stack:catalog-prod#ApiId'], names: { kind: 'api', name: 'shop' } });
    expect(exports['Outputs.Url']).toMatchObject({ names: { kind: 'api', name: 'shop' } });
    expect(exports['Outputs.TopicArn']).toMatchObject({ keys: ['export:restock-arn', 'stack:catalog-prod#TopicArn'], names: { kind: 'topic', name: 'restock' } });
    expect(deployment.roots.map((root) => [root.key, root.path])).toEqual([
      ['export:shop-api-id', '/'],
      ['stack:catalog-prod#ApiId', '/'],
      ['stack:catalog-prod#V1Id', '/v1'],
    ]);
  });

  it('hangs a REST resource and an HTTP route from points another stack exports', () => {
    const deployment = read({
      'template.yaml': template(
        [
          'List:',
          '  Type: AWS::Serverless::Function',
          '  Properties:',
          '    FunctionName: list',
          '    Handler: list.handler',
          'Products:',
          '  Type: AWS::ApiGateway::Resource',
          '  Properties:',
          '    RestApiId: !ImportValue shop-api-id',
          '    ParentId: !ImportValue shop-api-root',
          '    PathPart: products',
          'ProductsGet:',
          '  Type: AWS::ApiGateway::Method',
          '  Properties:',
          '    RestApiId: !ImportValue shop-api-id',
          '    ResourceId: !Ref Products',
          '    HttpMethod: GET',
          '    Integration:',
          '      Type: AWS_PROXY',
          '      Uri: !Sub arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${List.Arn}/invocations',
          'Integration:',
          '  Type: AWS::ApiGatewayV2::Integration',
          '  Properties:',
          '    ApiId: !ImportValue shop-http-id',
          '    IntegrationUri: !GetAtt List.Arn',
          'Route:',
          '  Type: AWS::ApiGatewayV2::Route',
          '  Properties:',
          '    ApiId: !ImportValue shop-http-id',
          '    RouteKey: GET /items/{id}',
          '    Target: !Sub integrations/${Integration}',
        ].join('\n'),
      ),
    });
    expect(deployment.routes.map((route) => [route.method, route.path, route.root])).toEqual([
      ['GET', `/${UNREAD_SPAN}/products`, { key: 'export:shop-api-root', below: '/products' }],
      ['GET', `/${UNREAD_SPAN}/items/:param`, { key: 'export:shop-http-id', below: '/items/:param' }],
    ]);
    expect(deployment.rows.map((row) => row.reason)).not.toContain('route-target-unread');
  });

  it('reads a queue, a topic and a value of the environment another stack exports, and says an event cannot take its API', () => {
    const deployment = read({
      'template.yaml': template(
        [
          'Reorder:',
          '  Type: AWS::Serverless::Function',
          '  Properties:',
          '    FunctionName: reorder',
          '    Handler: reorder.handler',
          '    Environment:',
          '      Variables:',
          '        SHOP_API_URL: !ImportValue shop-api-url',
          '    Events:',
          '      Placed:',
          '        Type: SQS',
          '        Properties:',
          '          Queue: !ImportValue orders-placed-arn',
          '      Restocked:',
          '        Type: SNS',
          '        Properties:',
          '          Topic: !ImportValue restock-arn',
          '      Old:',
          '        Type: Api',
          '        Properties:',
          '          RestApiId: !ImportValue shop-api-id',
          '          Path: /old',
          '          Method: get',
        ].join('\n'),
      ),
    });
    expect(deployment.deliveries.map((delivery) => delivery.from)).toEqual([
      { kind: 'queue', name: importedName('export:orders-placed-arn') },
      { kind: 'topic', name: importedName('export:restock-arn') },
    ]);
    expect(deployment.functions[0]?.environment?.['SHOP_API_URL']).toMatchObject({ imported: 'export:shop-api-url' });
    expect(deployment.imports?.map((site) => site.key)).toEqual(['export:shop-api-url', 'export:orders-placed-arn', 'export:restock-arn']);
    expect(deployment.routes).toEqual([]);
    expect(deployment.rows.find((row) => row.reason === 'route-path-unread')?.message).toContain('the transform does not take on an event');
  });
});
