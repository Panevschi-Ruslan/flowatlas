import { describe, expect, it } from 'vitest';
import { atChosenHost, matchServedAt, servedAtOf, type ServedAt } from './served-at.js';

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

  it('takes one label or several for each `**` of the host, as a name that may hold dots is written in (P328)', () => {
    const wide: ServedAt = { host: '**-v2.orders.example.test', base: [], api: 'shop' };
    expect(matchServedAt('staging-v2.orders.example.test', '/items', wide)?.path).toBe('/items');
    expect(matchServedAt('eu.prod-v2.orders.example.test', '/items', wide)?.path).toBe('/items');
    expect(matchServedAt('-v2.orders.example.test', '/items', wide)).toBeUndefined();
    expect(matchServedAt('eu..prod-v2.orders.example.test', '/items', wide)).toBeUndefined();
    expect(matchServedAt('eu.prod-v2.orders.example.test', '/items', { ...wide, host: '*-v2.orders.example.test' })).toBeUndefined();
    expect(atChosenHost('eu.prod.orders.example.test', { host: 'x', base: [], api: 'shop', chosenHost: '**.orders.example.test' })).toBe(true);
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

  it('puts back the part of the routes a place does not write, and tells the host deployed to where nothing chooses (P298)', () => {
    const under: ServedAt = { host: '*.gateway.region-1.example.test', base: ['prod'], api: 'shop', under: '/v1' };
    expect(matchServedAt('a1.gateway.region-1.example.test', '/prod/orders', under)?.path).toBe('/v1/orders');
    expect(matchServedAt('a1.gateway.region-1.example.test', '/prod', under)?.path).toBe('/v1');
    const anywhere: ServedAt = { host: '*.gateway.*.example.test', base: [], api: 'shop', chosenHost: '*.gateway.region-1.example.test' };
    expect(atChosenHost('a1.gateway.region-1.example.test', anywhere)).toBe(true);
    expect(atChosenHost('a1.gateway.region-2.example.test', anywhere)).toBe(false);
    expect(atChosenHost('a1.gateway.region-1.example.test', under)).toBe(false);
  });

  it('reads only well-formed entries out of a meta value', () => {
    expect(servedAtOf([FIXED, { host: 1 }, null, 'x'])).toEqual([FIXED]);
    expect(servedAtOf(undefined)).toEqual([]);
  });
});
