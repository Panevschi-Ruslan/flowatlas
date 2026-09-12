import { describe, expect, it } from 'vitest';
import { InvalidChannelNameError, InvalidIdError } from './errors.js';
import {
  makeChannelId,
  makeEntryId,
  makeHttpEntryKey,
  makeSymbolId,
  makeTypeId,
  normalizeFilePath,
  normalizePath,
} from './ids.js';

describe('normalizePath', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['', '/'],
    ['/', '/'],
    ['//', '/'],
    ['orders', '/orders'],
    ['/orders', '/orders'],
    ['/orders/', '/orders'],
    ['//orders//items//', '/orders/items'],
    ['/orders/:id', '/orders/:param'],
    ['/orders/{id}', '/orders/:param'],
    ['/orders/<id>', '/orders/:param'],
    ['/orders/:orderId/items/:itemId', '/orders/:param/items/:param'],
    ['orders/{id}/items/<itemId>/', '/orders/:param/items/:param'],
    ['/orders/:id?', '/orders/:param'],
    ['/orders/:id(\\d+)', '/orders/:param'],
    ['/files/*', '/files/*'],
    ['/orders/:param', '/orders/:param'],
    ['/Orders/Items', '/Orders/Items'],
    ['  /orders/:id  ', '/orders/:param'],
    ['/a/{}/b', '/a/:param/b'],
    ['/health', '/health'],
  ];

  it.each(cases)('normalizes %j to %j', (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });

  it('is idempotent', () => {
    for (const [input] of cases) {
      expect(normalizePath(normalizePath(input))).toBe(normalizePath(input));
    }
  });
});

describe('normalizeFilePath', () => {
  it('converts separators to POSIX', () => {
    expect(normalizeFilePath('src\\dto\\create.dto.ts')).toBe('src/dto/create.dto.ts');
  });

  it('makes a path inside the repo relative to it', () => {
    expect(normalizeFilePath('/repos/orders/src/app.ts', '/repos/orders')).toBe('src/app.ts');
  });

  it('tolerates a trailing slash on the repo directory', () => {
    expect(normalizeFilePath('/repos/orders/src/app.ts', '/repos/orders/')).toBe('src/app.ts');
  });

  it('leaves a path outside the repo alone', () => {
    expect(normalizeFilePath('/elsewhere/app.ts', '/repos/orders')).toBe('/elsewhere/app.ts');
  });

  it('strips a leading ./ and collapses repeated slashes', () => {
    expect(normalizeFilePath('./src//app.ts')).toBe('src/app.ts');
  });
});

describe('id constructors', () => {
  it('builds the symbol id forms from the plan', () => {
    expect(makeSymbolId('orders', 'src/orders.service.ts', 'OrdersService', 'create')).toBe(
      'orders#src/orders.service.ts:OrdersService.create',
    );
    expect(makeSymbolId('orders', 'src/orders.service.ts', 'OrdersService')).toBe(
      'orders#src/orders.service.ts:OrdersService',
    );
    expect(makeSymbolId('orders', 'src/util.ts', 'toCents')).toBe('orders#src/util.ts:toCents');
  });

  it('normalizes the file part of a symbol id', () => {
    expect(makeSymbolId('orders', './src\\a.ts', 'A')).toBe('orders#src/a.ts:A');
  });

  it('builds the entry ids from the plan', () => {
    expect(makeEntryId('orders', 'http', makeHttpEntryKey('POST', '/orders/:id'))).toBe(
      'entry:orders:http:POST:/orders/:param',
    );
    expect(makeEntryId('bot', 'bot_callback', 'order_confirm')).toBe(
      'entry:bot:bot_callback:order_confirm',
    );
  });

  it('upper-cases the method in an HTTP entry key', () => {
    expect(makeHttpEntryKey('post', 'orders/{id}')).toBe('POST:/orders/:param');
  });

  it('builds a channel id without a repo prefix', () => {
    expect(makeChannelId('order.created')).toBe('channel:order.created');
  });

  it('builds a type id', () => {
    expect(makeTypeId('orders', 'CreateOrderDto')).toBe('type:orders#CreateOrderDto');
  });

  it('rejects an empty or already prefixed channel name', () => {
    expect(() => makeChannelId('')).toThrow(InvalidChannelNameError);
    expect(() => makeChannelId('   ')).toThrow(InvalidChannelNameError);
    expect(() => makeChannelId('channel:order.created')).toThrow(InvalidChannelNameError);
  });

  it('rejects empty id parts', () => {
    expect(() => makeSymbolId('', 'a.ts', 'A')).toThrow(InvalidIdError);
    expect(() => makeTypeId('orders', '')).toThrow(InvalidIdError);
    expect(() => makeEntryId('orders', 'http', '')).toThrow(InvalidIdError);
  });
});
