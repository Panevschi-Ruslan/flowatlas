import { describe, expect, it } from 'vitest';
import { addressOnly, hostOf, innerServiceName, isInnerHost, keptValue, looksSecret, portOf } from './setting-files.js';

describe('what a value a file gives a setting may be kept as', () => {
  it('keeps the scheme, the host and the path of an address, and nothing else', () => {
    expect(addressOnly('http://orders:3000/api/v1/')).toBe('http://orders:3000/api/v1');
    expect(addressOnly('https://API.Example.com')).toBe('https://api.example.com');
    expect(addressOnly('https://user:hunter2@orders.example.com/v2?apiKey=abc#top')).toBe('https://orders.example.com/v2');
  });

  it('keeps a resource name as it is written', () => {
    expect(addressOnly('arn:partition:queues:eu-north-1:000000000000:orders-queue')).toBe(
      'arn:partition:queues:eu-north-1:000000000000:orders-queue',
    );
  });

  it('keeps nothing that is not an address a request is sent to', () => {
    expect(addressOnly('orders')).toBeUndefined();
    expect(addressOnly('3000')).toBeUndefined();
    expect(addressOnly('postgres://app:app@db:5432/app')).toBeUndefined();
    expect(addressOnly('redis://cache:6379')).toBeUndefined();
    expect(addressOnly('http://${HOST}:3000')).toBeUndefined();
    expect(addressOnly('')).toBeUndefined();
  });

  it('keeps nothing whose path carries a token', () => {
    expect(addressOnly('https://hooks.example.com/services/T0000000/B0000000/XXXXXXXXXXXXXXXXXXXXXXXX1')).toBeUndefined();
    expect(addressOnly('https://bots.example.org/bot123456789:AAbbCCddEEff/sendMessage')).toBeUndefined();
    expect(addressOnly('https://example.com/0123456789abcdef0123')).toBeUndefined();
    expect(addressOnly('https://example.com/v1/orders-and-returns')).toBe('https://example.com/v1/orders-and-returns');
  });

  it('keeps nothing of a setting whose name says it is a secret', () => {
    expect(looksSecret('API_KEY')).toBe(true);
    expect(looksSecret('stripeSecret')).toBe(true);
    expect(looksSecret('DB_PASSWORD')).toBe(true);
    expect(looksSecret('SENTRY_DSN')).toBe(true);
    expect(looksSecret('PASSPORT_URL')).toBe(false);
    expect(looksSecret('AUTH_SERVICE_URL')).toBe(false);
    expect(looksSecret('KEYCLOAK_URL')).toBe(false);
    expect(keptValue('WEBHOOK_URL', 'https://hooks.example.com/in')).toBeUndefined();
    expect(keptValue('ORDERS_URL', 'http://orders:3000')).toBe('http://orders:3000');
  });

  it('reads a port and a host', () => {
    expect(portOf('3000')).toBe(3000);
    expect(portOf(8080)).toBe(8080);
    expect(portOf('99999')).toBeUndefined();
    expect(portOf('abc')).toBeUndefined();
    expect(hostOf('http://Orders:3000/x')).toEqual({ host: 'orders:3000', hostname: 'orders' });
    expect(hostOf('arn:partition:queues:r:1:q')).toBeUndefined();
  });

  it('tells a host inside the project from a third party', () => {
    for (const host of ['localhost', '127.0.0.1', 'orders', '10.0.0.4', '172.20.0.2', 'orders.internal', 'orders.default.svc.cluster.local']) {
      expect(isInnerHost(host)).toBe(true);
    }
    for (const host of ['api.example.com', '8.8.8.8', '172.40.0.1']) expect(isInnerHost(host)).toBe(false);
    expect(innerServiceName('orders.default.svc.cluster.local')).toBe('orders');
    expect(innerServiceName('api.example.com')).toBeUndefined();
  });
});
