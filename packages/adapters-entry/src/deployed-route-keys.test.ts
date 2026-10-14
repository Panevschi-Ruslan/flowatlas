import { makeFunctionUrlEntryKey, makeHttpEntryKey, type Deployment } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { routeKeysOf } from './deployed-functions.js';

type Route = Deployment['routes'][number];

interface Shape {
  api?: string;
  key?: string;
  apiAddress?: string;
  listener?: string;
  target?: string;
}

const route = (method: string, path: string, shape: Shape = {}): { route: Route; target: string } => ({
  route: {
    file: 'infra/main.tf',
    line: 1,
    method,
    path,
    rawPath: path,
    ...(shape.api === undefined ? {} : { api: shape.api }),
    meta: {
      key: shape.key ?? makeHttpEntryKey(method, path),
      ...(shape.apiAddress === undefined ? {} : { apiAddress: shape.apiAddress }),
      ...(shape.listener === undefined ? {} : { listener: shape.listener }),
    },
  } as Route,
  target: shape.target ?? `${shape.api ?? shape.apiAddress ?? 'none'}:${method}:${path}`,
});

const keysOf = (routes: ReturnType<typeof route>[]): string[] => routeKeysOf(routes).map(({ key }) => key);

describe('route keys kept apart by their API (P59)', () => {
  it('keeps a deployment with one API on plain keys', () => {
    expect(keysOf([route('GET', '/status', { api: 'loans' }), route('POST', '/status', { api: 'loans' })])).toEqual([
      'GET:/status',
      'POST:/status',
    ]);
  });

  it('keys an address two APIs serve by each API', () => {
    expect(
      keysOf([route('GET', '/status', { api: 'loans' }), route('GET', '/status', { api: 'events' }), route('GET', '/books', { api: 'loans' })]),
    ).toEqual(['GET:/status@api:loans', 'GET:/status@api:events', 'GET:/books']);
  });

  it('keeps two routes of one API at one address on one key', () => {
    const health = route('GET', '/health', { api: 'staff-lb' });
    expect(keysOf([health, health])).toEqual(['GET:/health', 'GET:/health']);
  });

  it('leaves a route of no API, and a function URL, as they were', () => {
    const url = makeFunctionUrlEntryKey('card-lookup');
    expect(keysOf([route('GET', '/status'), route('GET', '/status', { api: 'loans' }), route('ALL', '/*', { key: url })])).toEqual([
      'GET:/status',
      'GET:/status',
      url,
    ]);
  });
});

describe('route keys kept apart by listener and by address (P61)', () => {
  it('keys two listeners of one load balancer sending one address to two targets by listener', () => {
    const keys = routeKeysOf([
      route('GET', '/health', { api: 'staff-lb', listener: 'HTTP:80', target: 'a' }),
      route('GET', '/health', { api: 'staff-lb', listener: 'HTTPS:443', target: 'b' }),
    ]);
    expect(keys).toEqual([
      { key: 'GET:/health@api:staff-lb@listener:HTTP:80', listener: 'HTTP:80' },
      { key: 'GET:/health@api:staff-lb@listener:HTTPS:443', listener: 'HTTPS:443' },
    ]);
  });

  it('keeps two listeners sending one address to one target as one route', () => {
    expect(
      keysOf([
        route('GET', '/health', { api: 'staff-lb', listener: 'HTTP:80', target: 'a' }),
        route('GET', '/health', { api: 'staff-lb', listener: 'HTTPS:443', target: 'a' }),
      ]),
    ).toEqual(['GET:/health', 'GET:/health']);
  });

  it('keys an API whose name is not read by its address', () => {
    const keys = routeKeysOf([
      route('GET', '/status', { apiAddress: 'aws_apigatewayv2_api.loans' }),
      route('GET', '/status', { apiAddress: 'aws_apigatewayv2_api.events' }),
    ]);
    expect(keys).toEqual([
      { key: 'GET:/status@api:aws_apigatewayv2_api.loans', apiAddress: 'aws_apigatewayv2_api.loans' },
      { key: 'GET:/status@api:aws_apigatewayv2_api.events', apiAddress: 'aws_apigatewayv2_api.events' },
    ]);
  });

  it('prefers the name to the address where the name is read', () => {
    expect(
      keysOf([
        route('GET', '/status', { api: 'library-loans-api', apiAddress: 'aws_apigatewayv2_api.loans' }),
        route('GET', '/status', { apiAddress: 'aws_apigatewayv2_api.events' }),
      ]),
    ).toEqual(['GET:/status@api:library-loans-api', 'GET:/status@api:aws_apigatewayv2_api.events']);
  });

  it('sees routes of every deployment of the repository at once', () => {
    // Two readers' routes, handed in together, as the adapter does.
    expect(
      keysOf([route('GET', '/status', { api: 'loans', target: '0:a' }), route('GET', '/status', { api: 'events', target: '1:a' })]),
    ).toEqual(['GET:/status@api:loans', 'GET:/status@api:events']);
  });
});
