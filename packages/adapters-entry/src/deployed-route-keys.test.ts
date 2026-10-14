import { makeFunctionUrlEntryKey, makeHttpEntryKey, type Deployment } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { keyOfRoute, keysSharedByApis } from './deployed-functions.js';

type Route = Deployment['routes'][number];

const route = (method: string, path: string, api?: string, key?: string): Route =>
  ({
    file: 'infra/main.tf',
    line: 1,
    method,
    path,
    rawPath: path,
    ...(api === undefined ? {} : { api }),
    meta: { key: key ?? makeHttpEntryKey(method, path) },
  }) as Route;

const keysOf = (routes: Route[]): string[] => {
  const shared = keysSharedByApis(routes);
  return routes.map((each) => keyOfRoute(each, shared));
};

describe('route keys kept apart by their API (P59)', () => {
  it('keeps a deployment with one API on plain keys', () => {
    expect(keysOf([route('GET', '/status', 'loans'), route('POST', '/status', 'loans')])).toEqual(['GET:/status', 'POST:/status']);
  });

  it('keys an address two APIs serve by each API', () => {
    expect(keysOf([route('GET', '/status', 'loans'), route('GET', '/status', 'events'), route('GET', '/books', 'loans')])).toEqual([
      'GET:/status@api:loans',
      'GET:/status@api:events',
      'GET:/books',
    ]);
  });

  it('keeps two routes of one API at one address on one key', () => {
    expect(keysOf([route('GET', '/health', 'staff-lb'), route('GET', '/health', 'staff-lb')])).toEqual(['GET:/health', 'GET:/health']);
  });

  it('leaves a route of no named API, and a function URL, as they were', () => {
    const url = makeFunctionUrlEntryKey('card-lookup');
    expect(keysOf([route('GET', '/status'), route('GET', '/status', 'loans'), route('ALL', '/*', undefined, url)])).toEqual([
      'GET:/status',
      'GET:/status',
      url,
    ]);
  });
});
