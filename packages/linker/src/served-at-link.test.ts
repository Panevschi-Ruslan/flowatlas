import type { GraphNode, ServedAt } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { findingFor, resolveCall, type RouteIndex } from './http-link.js';
import { apiServedAt, servedAtFinding } from './served-at-link.js';
import { resolveUiCall, uiFindingFor, type UiIndex } from './ui-link.js';

/**
 * A request whose address is written out where a deployment's API is served,
 * with an id no file holds (P284). Neutral names: a gateway host of a region,
 * a `*` for the label the platform assigns.
 */
const HOST = 'a1b2c3.gateway.region-1.example.test';
const served = (api: string, base: readonly string[], chosenDefault?: string): ServedAt => ({
  host: '*.gateway.region-1.example.test',
  base,
  api,
  ...(chosenDefault === undefined ? {} : { chosenDefault }),
});

const route = (repo: string, method: string, path: string, at: readonly ServedAt[]): GraphNode => ({
  id: `entry:${repo}:http:${method}:${path}@${at.map((each) => each.api).join(',')}`,
  type: 'entry',
  kind: 'http',
  label: `${method} ${path}`,
  repo,
  meta: { method, path, servedAt: at },
});

const uiIndex = (routes: Record<string, readonly GraphNode[]>): UiIndex => ({
  routesOf: (service) => routes[service],
  targetOf: () => undefined,
  claimantsOf: () => [],
  services: () => Object.keys(routes).sort(),
});

const uiCall = (method: string, path: string, host = HOST): GraphNode => ({
  id: `ui_api_call:web#js/orders.js:3:2`,
  type: 'ui_api_call',
  kind: 'http',
  label: `${method} ${path}`,
  repo: 'web',
  meta: { method, path, host, url: `https://${host}${path}` },
});

const REST_OPEN = served('prod-shop', ['*'], 'prod');
const REST_PROD = served('prod-shop', ['prod']);
const HTTP = served('prod-shop', []);

describe('a browser request to an address where one API of the project is served (P284)', () => {
  const shop = [route('shop', 'POST', '/orders', [REST_OPEN]), route('shop', 'GET', '/slots', [REST_OPEN]), route('shop', 'DELETE', '/orders/:id', [HTTP])];

  it('is that API, asked for the path after the stage the deployment may be run with', () => {
    const outcome = resolveUiCall(uiCall('POST', '/dev/orders'), uiIndex({ shop }));
    expect(outcome).toMatchObject({ kind: 'linked', via: 'served-at', targetService: 'shop', entry: { id: shop[0]?.id } });
    expect(outcome.kind === 'linked' ? outcome.servedAt?.path : undefined).toBe('/orders');
  });

  it('asks the API with a route for it first: an HTTP API at its default stage is served at every path of the host', () => {
    expect(resolveUiCall(uiCall('DELETE', '/orders/:param'), uiIndex({ shop }))).toMatchObject({ kind: 'linked', entry: { id: shop[2]?.id } });
    expect(resolveUiCall(uiCall('GET', '/dev/slots'), uiIndex({ shop }))).toMatchObject({ kind: 'linked', entry: { id: shop[1]?.id } });
  });

  it('says what it took, and why it is a guess', () => {
    const answer = apiServedAt('POST', HOST, '/dev/orders', `https://${HOST}/dev/orders`, ['shop'], () => shop);
    expect(answer?.kind).toBe('one');
    const finding = answer?.kind === 'one' ? servedAtFinding(answer.found) : undefined;
    expect(finding).toMatchObject({ reason: 'base-url-from-files', level: 'info' });
    expect(finding?.message).toContain('at whatever stage it is run with (prod where none is given), so the stage dev is taken as one of its');
    expect(finding?.message).toContain('the request as one for /orders on it');
  });

  it('is no API in another region, or at a stage the deployment writes and the address does not', () => {
    expect(resolveUiCall(uiCall('POST', '/dev/orders', 'a1b2c3.gateway.region-2.example.test'), uiIndex({ shop }))).toMatchObject({ kind: 'noRoute', targetService: null });
    const fixed = [route('shop', 'POST', '/orders', [REST_PROD])];
    expect(resolveUiCall(uiCall('POST', '/dev/orders'), uiIndex({ shop: fixed }))).toMatchObject({ kind: 'noRoute', targetService: null });
    expect(resolveUiCall(uiCall('POST', '/prod/orders'), uiIndex({ shop: fixed }))).toMatchObject({ kind: 'linked', via: 'served-at' });
  });

  it('is the one whose stage is written before one whose stage is left open', () => {
    const fixed = [route('shop', 'POST', '/orders', [REST_PROD])];
    const other = [route('billing', 'POST', '/orders', [served('billing', ['*'], 'dev')])];
    expect(resolveUiCall(uiCall('POST', '/prod/orders'), uiIndex({ shop: fixed, billing: other }))).toMatchObject({ kind: 'linked', targetService: 'shop' });
  });

  it('is a row naming them where several APIs answer there', () => {
    const other = [route('billing', 'POST', '/orders', [served('dev-billing', ['*'], 'dev')])];
    const outcome = resolveUiCall(uiCall('POST', '/dev/orders'), uiIndex({ shop, billing: other }));
    expect(outcome).toEqual({ kind: 'apiAmbiguous', method: 'POST', path: '/dev/orders', host: HOST, apis: ['billing dev-billing', 'shop prod-shop'] });
    expect(uiFindingFor(outcome)).toMatchObject({ reason: 'ambiguous-route-target' });
  });

  it('is the API with no such route where only it is served there', () => {
    expect(resolveUiCall(uiCall('PUT', '/dev/orders'), uiIndex({ shop }))).toMatchObject({ kind: 'noRoute', targetService: 'shop' });
  });

  it('leaves a host the configuration places to the configuration', () => {
    const index: UiIndex = { ...uiIndex({ shop, billing: [route('billing', 'POST', '/dev/orders', [])] }), serviceAtHost: () => ({ kind: 'service', service: 'billing', sure: true }) };
    expect(resolveUiCall(uiCall('POST', '/dev/orders'), index)).toMatchObject({ kind: 'linked', via: 'host', targetService: 'billing' });
  });
});

describe('a request between services to such an address (P284)', () => {
  const shop = [route('shop', 'POST', '/orders', [REST_OPEN])];
  const index = (routes: Record<string, readonly GraphNode[]>): RouteIndex => ({
    routesOf: (service) => routes[service],
    claimantsOf: () => [],
    markerOf: () => undefined,
    services: () => Object.keys(routes).sort(),
  });
  const out = (method: string, path: string): GraphNode => ({
    id: 'http_out:worker#src/sync.ts:9',
    type: 'http_out',
    label: `${method} ${path}`,
    repo: 'worker',
    meta: { method, path, host: HOST, url: `https://${HOST}${path}` },
  });

  it('is joined to the API, with the note', () => {
    const { outcome, notes } = resolveCall(out('POST', '/dev/orders'), index({ shop }));
    expect(outcome).toMatchObject({ kind: 'linked', via: 'servedAt', entry: { id: shop[0]?.id } });
    expect(notes.map((note) => note.reason)).toEqual(['base-url-from-files']);
  });

  it('is a row where several APIs answer, and a third party where none is served', () => {
    const other = [route('billing', 'POST', '/orders', [served('dev-billing', ['*'], 'dev')])];
    const { outcome } = resolveCall(out('POST', '/dev/orders'), index({ shop, billing: other }));
    expect(outcome.kind).toBe('apiAmbiguous');
    expect(findingFor(outcome)).toMatchObject({ reason: 'ambiguous-route-target' });
    expect(resolveCall(out('POST', '/dev/orders'), index({ billing: [route('billing', 'POST', '/orders', [])] })).outcome.kind).toBe('external');
  });
});
