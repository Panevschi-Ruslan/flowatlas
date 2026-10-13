import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
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
