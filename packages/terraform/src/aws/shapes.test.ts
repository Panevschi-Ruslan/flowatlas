import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseConfig, type DeliveryTarget, type Deployment } from '@flowatlas/core';
import { terraformReader } from '../index.js';

/** The Terraform shapes R174 reads: JSON syntax, an OpenAPI body, a WebSocket API, base paths. */

const FIXTURES = resolve(import.meta.dirname, '../../../../fixtures');

const readFixture = (path: string): Deployment => terraformReader.read({ repoDir: join(FIXTURES, path), config: parseConfig({}) });

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const readFiles = (files: Record<string, string>): Deployment => {
  const dir = mkdtempSync(join(tmpdir(), 'flowatlas-shapes-'));
  scratch.push(dir);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return terraformReader.read({ repoDir: dir, config: parseConfig({}) });
};

const routes = (deployment: Deployment): string[] => deployment.routes.map((route) => `${route.method} ${route.path}`).sort();

describe('configuration written as JSON', () => {
  const deployment = readFixture('lambda-terraform-json/catalogue');

  it('reads functions, a local module and routes, each on its own line', () => {
    expect(deployment.functions.map((fn) => [fn.name, fn.handler?.written, fn.file, fn.line])).toEqual([
      ['library-dev-get-item', 'items/get-item.handler', 'infra/functions.tf.json', 4],
      ['library-dev-add-item', 'items/add-item.handler', 'infra/modules/function/main.tf.json', 11],
    ]);
    expect(routes(deployment)).toEqual(['GET /items/:param', 'POST /items']);
    expect(deployment.rows).toEqual([]);
  });

  it('is declared by a repository of nothing but JSON', () => {
    expect(terraformReader.declares(join(FIXTURES, 'lambda-terraform-json/catalogue'))).toBe(true);
  });
});

describe('an API created from an OpenAPI document', () => {
  const deployment = readFixture('lambda-terraform-openapi/circulation');
  const route = (key: string) => deployment.routes.find((found) => `${found.method} ${found.path}` === key);

  it('reads every operation of a templatefile body and of a jsonencode body, placed in its document', () => {
    expect(routes(deployment)).toEqual([
      'GET /items/:param',
      'GET /loans/:param',
      'POST /holds',
      'POST /loans',
      'POST /loans/:param/renewals',
      'POST /returns',
    ]);
    expect(route('POST /loans')).toMatchObject({ file: 'infra/openapi.yaml', line: 8, api: 'library-circulation' });
    expect(route('POST /holds')).toMatchObject({ file: 'infra/api.tf', api: 'library-kiosk' });
    expect(deployment.rows).toEqual([]);
  });

  it('finds the function a template variable that is a reference names, alone or inside an invoke address', () => {
    const index = (name: string) => deployment.functions.findIndex((fn) => fn.name === name);
    expect(route('POST /loans')?.target).toEqual({ function: index('library-create-loan') });
    expect(route('POST /loans/:param/renewals')?.target).toEqual({ function: index('library-renew-loan') });
    expect(route('GET /items/:param')?.target).toEqual({ function: index('library-get-item') });
  });

  it('reads a service integration as a route that sends, and security as a guard', () => {
    expect(route('POST /returns')?.target).toEqual({ sends: { kind: 'queue', name: 'library-returns' } });
    expect(route('POST /holds')?.target).toEqual({ sends: { kind: 'queue', name: 'library-hold-requests' } });
    expect(route('GET /loans/:param')?.guards?.map((guard) => guard.label)).toEqual(['librarians']);
  });

  it('says why a body is not read', () => {
    const unread = readFiles({
      'main.tf': 'resource "aws_api_gateway_rest_api" "x" {\n  name = "x"\n  body = file(var.document)\n}\nvariable "document" {}\n',
    });
    expect(unread.routes).toEqual([]);
    expect(unread.rows).toEqual([expect.objectContaining({ reason: 'api-body-unread', meta: expect.objectContaining({ variable: 'document' }) })]);
  });
});

describe('a WebSocket API', () => {
  const deployment = readFixture('lambda-terraform-websocket/reading-room');

  it('is a delivery from its connections per route key, onto the function its integration invokes', () => {
    expect(deployment.routes).toEqual([]);
    const runs = (to: DeliveryTarget | undefined): string | undefined =>
      to !== undefined && 'function' in to ? deployment.functions[to.function]?.name : undefined;
    expect(
      deployment.deliveries.map((delivery) => [delivery.from, runs(delivery.to), delivery.meta?.['authorization']]),
    ).toEqual([
      [{ kind: 'connection', api: 'library-reading-room', route: '$connect' }, 'library-reading-room-connect', 'CUSTOM'],
      [{ kind: 'connection', api: 'library-reading-room', route: '$disconnect' }, 'library-reading-room-disconnect', undefined],
      [{ kind: 'connection', api: 'library-reading-room', route: 'askLibrarian' }, 'library-reading-room-ask', undefined],
      [{ kind: 'connection', api: 'library-reading-room', route: '$default' }, 'library-reading-room-fallback', undefined],
    ]);
    expect(deployment.rows).toEqual([]);
  });
});

describe('base paths and stages', () => {
  const deployment = readFixture('lambda-terraform-base-paths/catalogue');

  it('puts a mapping\'s base path in front of every route, and records the stage beside it', () => {
    expect(deployment.routes.map((route) => [route.method, route.path, route.meta])).toEqual([
      ['GET', '/v1/items/:param', expect.objectContaining({ basePath: '/v1', domains: ['api.library.example'], stages: ['live'] })],
      ['POST', '/holds/requests', expect.objectContaining({ basePath: '/holds', domains: ['api.library.example'], stages: ['$default'] })],
    ]);
  });

  const api = [
    'resource "aws_apigatewayv2_api" "x" {\n  name = "x"\n  protocol_type = "HTTP"\n}',
    'resource "aws_apigatewayv2_route" "r" {\n  api_id = aws_apigatewayv2_api.x.id\n  route_key = "GET /items"\n}',
    'resource "aws_apigatewayv2_stage" "live" {\n  api_id = aws_apigatewayv2_api.x.id\n  name = "live"\n}',
  ].join('\n');

  it('puts no stage in front of an API nothing maps', () => {
    const plain = readFiles({ 'main.tf': api });
    expect(plain.routes.map((route) => [route.path, route.meta?.['stages']])).toEqual([['/items', ['live']]]);
  });

  it('reads a route at each base path it is mapped at, and holds an unread one as unread', () => {
    const mapping = (name: string, key: string): string =>
      `resource "aws_apigatewayv2_api_mapping" "${name}" {\n  api_id = aws_apigatewayv2_api.x.id\n  domain_name = "api.example"\n  stage = "live"\n  api_mapping_key = ${key}\n}`;
    const twice = readFiles({ 'main.tf': [api, mapping('a', '"v1"'), mapping('b', '"v2"')].join('\n') });
    expect(routes(twice)).toEqual(['GET /v1/items', 'GET /v2/items']);
    const unread = readFiles({ 'main.tf': [api, mapping('a', 'var.base'), 'variable "base" {}'].join('\n') });
    expect(unread.routes.map((route) => route.path)).toEqual([expect.stringMatching(/^\/\$\{…\}.*\/items$/)]);
    expect(unread.rows).toEqual([expect.objectContaining({ reason: 'route-base-path-unread' })]);
  });
});

describe('where an API is served by its own address (P294)', () => {
  const route = (api: string): string =>
    `resource "aws_apigatewayv2_route" "r_${api}" {\n  api_id = aws_apigatewayv2_api.${api}.id\n  route_key = "GET /items"\n}`;
  const http = (name: string, more = ''): string => `resource "aws_apigatewayv2_api" "${name}" {\n  name = "${name}"\n  protocol_type = "HTTP"\n${more}}`;
  const stage = (api: string, name: string, value: string): string =>
    `resource "aws_apigatewayv2_stage" "${name}" {\n  api_id = aws_apigatewayv2_api.${api}.id\n  name = ${value}\n}`;
  const servedOf = (deployment: Deployment): unknown[] => deployment.routes.map((each) => [each.api, each.meta?.['servedAt']]);

  it("is served in the provider's region, at the root of $default and under every other stage, a variable's stage open", () => {
    const deployment = readFiles({
      'main.tf': [
        'provider "aws" {\n  region = "eu-west-1"\n}',
        'variable "stage" {\n  default = "dev"\n}',
        http('x'),
        route('x'),
        stage('x', 'root', '"$default"'),
        stage('x', 'live', '"live"'),
        stage('x', 'chosen', 'var.stage'),
      ].join('\n'),
    });
    expect(servedOf(deployment)).toEqual([
      [
        'x',
        [
          { host: '*.execute-api.eu-west-1.amazonaws.com', base: [], api: 'x' },
          { host: '*.execute-api.eu-west-1.amazonaws.com', base: ['live'], api: 'x' },
          { host: '*.execute-api.eu-west-1.amazonaws.com', base: ['*'], api: 'x', chosenDefault: 'dev' },
        ],
      ],
    ]);
  });

  it('takes the region of the provider a block names, any region where none is set, and a stage chosen elsewhere where none is read', () => {
    const deployment = readFiles({
      'main.tf': [
        'provider "aws" {\n  alias = "west"\n  region = "us-west-2"\n}',
        http('x', '  provider = aws.west\n'),
        route('x'),
        http('y'),
        route('y'),
        http('z', '  disable_execute_api_endpoint = true\n'),
        route('z'),
      ].join('\n'),
    });
    expect(servedOf(deployment)).toEqual([
      ['x', [{ host: '*.execute-api.us-west-2.amazonaws.com', base: ['*'], api: 'x' }]],
      ['y', [{ host: '*.execute-api.*.amazonaws.com', base: ['*'], api: 'y' }]],
      ['z', undefined],
    ]);
  });

  it('opens a stage a local or a module input reads a root variable or the workspace through, and takes the provider a module call hands its module (P298)', () => {
    const deployment = readFiles({
      'main.tf': [
        'provider "aws" {\n  region = "us-east-1"\n}',
        'provider "aws" {\n  alias = "west"\n  region = "eu-west-2"\n}',
        'variable "stage" {\n  default = "staging"\n}',
        'locals {\n  stage = var.stage\n}',
        http('x'),
        route('x'),
        stage('x', 'chosen', 'local.stage'),
        'module "handed" {\n  source = "./api"\n  stage = var.stage\n  providers = {\n    aws = aws.west\n  }\n}',
        'module "fixed" {\n  source = "./api"\n  stage = "live"\n}',
      ].join('\n'),
      'api/main.tf': ['variable "stage" {}', http('y'), route('y'), stage('y', 's', 'var.stage')].join('\n'),
    });
    expect(servedOf(deployment)).toEqual([
      ['x', [{ host: '*.execute-api.us-east-1.amazonaws.com', base: ['*'], api: 'x', chosenDefault: 'staging' }]],
      ['y', [{ host: '*.execute-api.eu-west-2.amazonaws.com', base: ['*'], api: 'y', chosenDefault: 'staging' }]],
      ['y', [{ host: '*.execute-api.us-east-1.amazonaws.com', base: ['live'], api: 'y' }]],
    ]);
  });

  it('is served at each custom domain an API is mapped onto, its base path in front of the routes, and at its own address without it (P298)', () => {
    const rest = (more = ''): string =>
      [
        `resource "aws_api_gateway_rest_api" "shop" {\n  name = "shop"\n${more}}`,
        'resource "aws_api_gateway_resource" "items" {\n  rest_api_id = aws_api_gateway_rest_api.shop.id\n  parent_id = aws_api_gateway_rest_api.shop.root_resource_id\n  path_part = "items"\n}',
        'resource "aws_api_gateway_method" "list" {\n  rest_api_id = aws_api_gateway_rest_api.shop.id\n  resource_id = aws_api_gateway_resource.items.id\n  http_method = "GET"\n  authorization = "NONE"\n}',
        'resource "aws_api_gateway_stage" "live" {\n  rest_api_id = aws_api_gateway_rest_api.shop.id\n  stage_name = "live"\n}',
        'resource "aws_api_gateway_domain_name" "shop" {\n  domain_name = "api.shop.example"\n}',
        'resource "aws_api_gateway_base_path_mapping" "shop" {\n  api_id = aws_api_gateway_rest_api.shop.id\n  stage_name = aws_api_gateway_stage.live.stage_name\n  domain_name = aws_api_gateway_domain_name.shop.domain_name\n  base_path = "v1"\n}',
      ].join('\n');
    const mapped = readFiles({ 'main.tf': ['provider "aws" {\n  region = "eu-west-1"\n}', rest()].join('\n') });
    expect(routes(mapped)).toEqual(['GET /v1/items']);
    expect(servedOf(mapped)).toEqual([
      [
        'shop',
        [
          { host: 'api.shop.example', base: [], api: 'shop' },
          { host: '*.execute-api.eu-west-1.amazonaws.com', base: ['live'], api: 'shop', under: '/v1' },
        ],
      ],
    ]);
    // An API whose own address is turned off is served at its domain alone.
    const domainOnly = readFiles({ 'main.tf': rest('  disable_execute_api_endpoint = true\n') });
    expect(servedOf(domainOnly)).toEqual([['shop', [{ host: 'api.shop.example', base: [], api: 'shop' }]]]);
  });

  it('opens a stage the workspace names with the default workspace, and with each workspace a map it is looked up in is written for (P304)', () => {
    const deployment = readFiles({
      'main.tf': [
        'provider "aws" {\n  region = "eu-west-1"\n}',
        'variable "stage_names" {\n  default = {\n    default = "dev"\n    production = "live"\n  }\n}',
        'locals {\n  env = {\n    default = { stage = "sandbox" }\n    staging = { stage = "preview" }\n  }\n  stage = local.env[terraform.workspace].stage\n}',
        http('plain'),
        route('plain'),
        stage('plain', 'plain_ws', 'terraform.workspace'),
        http('looked'),
        route('looked'),
        stage('looked', 'looked_ws', 'lookup(var.stage_names, terraform.workspace)'),
        http('keyed'),
        route('keyed'),
        stage('keyed', 'keyed_ws', 'local.stage'),
        'module "handed" {\n  source = "./api"\n  stage = "${terraform.workspace}-v2"\n}',
      ].join('\n'),
      'api/main.tf': ['variable "stage" {}', http('child'), route('child'), stage('child', 's', 'var.stage')].join('\n'),
    });
    // Only the default workspace's stage is the one where none is given; another
    // workspace's says which workspace deploys to it (P308).
    const at = (api: string, ...stages: (string | [string, string])[]): unknown[] => [
      api,
      stages.map((each) => ({
        host: '*.execute-api.eu-west-1.amazonaws.com',
        base: ['*'],
        api,
        ...(typeof each === 'string' ? { chosenDefault: each } : { chosenDefault: each[0], chosenIn: `the workspace ${each[1]}` }),
      })),
    ];
    expect(servedOf(deployment)).toEqual([
      at('plain', 'default'),
      at('looked', 'dev', ['live', 'production']),
      at('keyed', ['preview', 'staging'], 'sandbox'),
      at('child', 'default-v2'),
    ]);
    // The stages of an API nothing maps name each workspace's (P308).
    expect(deployment.routes.map((each) => [each.api, each.meta?.['stages']])).toEqual([
      ['plain', ['default']],
      ['looked', ['dev', 'live']],
      ['keyed', ['preview', 'sandbox']],
      ['child', ['default-v2']],
    ]);
  });

  it('opens the stage a mapping names by the workspace, written in the mapping or in the stage it references (P316)', () => {
    const mapping = (api: string, value: string): string =>
      `resource "aws_apigatewayv2_api_mapping" "m_${api}" {\n  api_id = aws_apigatewayv2_api.${api}.id\n  domain_name = "${api}.shop.example"\n  stage = ${value}\n}`;
    const deployment = readFiles({
      'main.tf': [
        'provider "aws" {\n  region = "eu-west-1"\n}',
        'variable "stage_names" {\n  default = {\n    default = "dev"\n    production = "live"\n  }\n}',
        'locals {\n  stage = lookup(var.stage_names, terraform.workspace)\n}',
        http('direct'),
        route('direct'),
        mapping('direct', 'terraform.workspace'),
        http('looked'),
        route('looked'),
        mapping('looked', 'local.stage'),
        http('through'),
        route('through'),
        stage('through', 'through_ws', 'lookup(var.stage_names, terraform.workspace)'),
        mapping('through', 'aws_apigatewayv2_stage.through_ws.id'),
      ].join('\n'),
    });
    expect(deployment.routes.map((each) => [each.api, each.meta?.['stages'], each.meta?.['domains']])).toEqual([
      ['direct', ['default'], ['direct.shop.example']],
      ['looked', ['dev', 'live'], ['looked.shop.example']],
      ['through', ['dev', 'live'], ['through.shop.example']],
    ]);
  });
});

describe('a custom domain the workspace names (P322)', () => {
  const route = (api: string): string =>
    `resource "aws_apigatewayv2_route" "r_${api}" {\n  api_id = aws_apigatewayv2_api.${api}.id\n  route_key = "GET /items"\n}`;
  const http = (name: string): string => `resource "aws_apigatewayv2_api" "${name}" {\n  name = "${name}"\n  protocol_type = "HTTP"\n  disable_execute_api_endpoint = true\n}`;
  const mapping = (api: string, domain: string): string =>
    `resource "aws_apigatewayv2_api_mapping" "m_${api}" {\n  api_id = aws_apigatewayv2_api.${api}.id\n  domain_name = ${domain}\n  stage = "$default"\n}`;

  it('opens a domain the workspace is written into, lists each one a map names, and reads one a domain resource names', () => {
    const deployment = readFiles({
      'main.tf': [
        'provider "aws" {\n  region = "eu-west-1"\n}',
        'variable "domains" {\n  default = {\n    default = "dev.shop.example"\n    production = "api.shop.example"\n  }\n}',
        'locals {\n  host = lookup(var.domains, terraform.workspace, "sandbox.shop.example")\n}',
        http('open'),
        route('open'),
        mapping('open', '"${terraform.workspace}.orders.shop.example"'),
        http('keyed'),
        route('keyed'),
        mapping('keyed', 'var.domains[terraform.workspace]'),
        http('fallback'),
        route('fallback'),
        mapping('fallback', 'local.host'),
        http('through'),
        route('through'),
        'resource "aws_apigatewayv2_domain_name" "through" {\n  domain_name = "${terraform.workspace}-v2.shop.example"\n}',
        mapping('through', 'aws_apigatewayv2_domain_name.through.domain_name'),
        http('fixed'),
        route('fixed'),
        mapping('fixed', '"fixed.shop.example"'),
      ].join('\n'),
    });
    const at = (api: string, ...hosts: Record<string, string>[]): unknown[] => [api, hosts.map((each) => ({ base: [], api, ...each }))];
    expect(deployment.routes.map((each) => [each.api, each.meta?.['servedAt']])).toEqual([
      at('open', { host: '*.orders.shop.example', chosenHost: 'default.orders.shop.example', hostChosenBy: 'the workspace' }),
      at('keyed', { host: 'api.shop.example', chosenIn: 'the workspace production' }, { host: 'dev.shop.example' }),
      at('fallback', { host: 'api.shop.example', chosenIn: 'the workspace production' }, { host: 'dev.shop.example' }, { host: 'sandbox.shop.example', chosenIn: 'any other workspace' }),
      at('through', { host: '*-v2.shop.example', chosenHost: 'default-v2.shop.example', hostChosenBy: 'the workspace' }),
      at('fixed', { host: 'fixed.shop.example' }),
    ]);
    expect(deployment.routes.map((each) => [each.api, each.meta?.['domains']])).toEqual([
      ['open', ['*.orders.shop.example']],
      ['keyed', ['api.shop.example', 'dev.shop.example']],
      ['fallback', ['api.shop.example', 'dev.shop.example', 'sandbox.shop.example']],
      ['through', ['*-v2.shop.example']],
      ['fixed', ['fixed.shop.example']],
    ]);
  });

  it('reads the stage a mapping names by the stage resource\'s own argument, the workspace naming it', () => {
    const deployment = readFiles({
      'main.tf': [
        'variable "stage_names" {\n  default = {\n    default = "dev"\n    production = "live"\n  }\n}',
        http('named'),
        route('named'),
        'resource "aws_apigatewayv2_stage" "named" {\n  api_id = aws_apigatewayv2_api.named.id\n  name = lookup(var.stage_names, terraform.workspace)\n}',
        'resource "aws_apigatewayv2_api_mapping" "m_named" {\n  api_id = aws_apigatewayv2_api.named.id\n  domain_name = "named.shop.example"\n  stage = aws_apigatewayv2_stage.named.name\n}',
      ].join('\n'),
    });
    expect(deployment.routes.map((each) => each.meta?.['stages'])).toEqual([['dev', 'live']]);
  });
});
