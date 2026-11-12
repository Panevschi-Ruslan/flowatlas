import { describe, expect, it } from 'vitest';
import { matchServedAt, servedAtOf, type ServedAt } from './served-at.js';

const OPEN: ServedAt = { host: '*.gateway.region-1.example.test', base: ['*'], api: 'shop', chosenDefault: 'prod' };
const FIXED: ServedAt = { host: '*.gateway.region-1.example.test', base: ['prod'], api: 'shop' };
const NONE: ServedAt = { host: '*.gateway.region-1.example.test', base: [], api: 'shop' };

describe('where an API is served (P284)', () => {
  it('takes one label for each `*` of the host, and no more', () => {
    expect(matchServedAt('a1b2c3.gateway.region-1.example.test', '/prod/orders', FIXED)).toEqual({ served: FIXED, path: '/orders', written: ['prod'] });
    expect(matchServedAt('A1B2C3.Gateway.Region-1.example.test', '/prod/orders', FIXED)?.path).toBe('/orders');
    expect(matchServedAt('a.b.gateway.region-1.example.test', '/prod/orders', FIXED)).toBeUndefined();
    expect(matchServedAt('a1b2c3.gateway.region-2.example.test', '/prod/orders', FIXED)).toBeUndefined();
    expect(matchServedAt('a1b2c3xgatewayxregion-1.example.test', '/prod/orders', FIXED)).toBeUndefined();
  });

  it('asks the base of the path: a written stage is that one, an open one any, none nothing', () => {
    expect(matchServedAt('a1.gateway.region-1.example.test', '/dev/orders', FIXED)).toBeUndefined();
    expect(matchServedAt('a1.gateway.region-1.example.test', '/dev/orders/1', OPEN)).toEqual({ served: OPEN, path: '/orders/1', written: ['dev'] });
    expect(matchServedAt('a1.gateway.region-1.example.test', '/dev/orders', NONE)).toEqual({ served: NONE, path: '/dev/orders', written: [] });
    expect(matchServedAt('a1.gateway.region-1.example.test', '/', OPEN)).toBeUndefined();
    expect(matchServedAt('a1.gateway.region-1.example.test', '/prod', FIXED)?.path).toBe('/');
  });

  it('matches a host with nothing open as written', () => {
    const plain: ServedAt = { host: 'api.example.test', base: ['v1'], api: 'shop' };
    expect(matchServedAt('api.example.test', '/v1/orders', plain)?.path).toBe('/orders');
    expect(matchServedAt('x.api.example.test', '/v1/orders', plain)).toBeUndefined();
  });

  it('reads only well-formed entries out of a meta value', () => {
    expect(servedAtOf([FIXED, { host: 1 }, null, 'x'])).toEqual([FIXED]);
    expect(servedAtOf(undefined)).toEqual([]);
  });
});
