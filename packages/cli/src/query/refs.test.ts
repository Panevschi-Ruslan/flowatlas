import type { GraphDb } from '@flowatlas/linker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CliError, EXIT } from '../exit.js';
import { buildTestProject } from '../test-graph.js';
import { channelIdOf, resolveChannel, resolveEntry, resolveSymbol } from './refs.js';

let db: GraphDb;

beforeAll(() => {
  db = buildTestProject('refs').db;
});

afterAll(() => db.close());

const failure = (run: () => unknown): CliError => {
  try {
    run();
  } catch (error) {
    return error as CliError;
  }
  throw new Error('expected a stop');
};

describe('naming an entry point', () => {
  it('takes a full id as it stands', () => {
    expect(resolveEntry(db, 'entry:orders:http:POST:/orders').id).toBe('entry:orders:http:POST:/orders');
  });

  it('takes a route the way a router matches it, concrete id and all', () => {
    expect(resolveEntry(db, 'POST /orders', 'orders').id).toBe('entry:orders:http:POST:/orders');
  });

  it('takes a bot callback by the key it is registered under', () => {
    expect(resolveEntry(db, 'bot:order_confirm').id).toBe('entry:gateway:bot_callback:order_confirm');
  });

  it('takes a channel handler by the channel it listens to', () => {
    expect(resolveEntry(db, 'event:order.created').id).toBe('entry:billing:event:order.created');
  });

  it('lists the candidates rather than picking one when two services answer', () => {
    const error = failure(() => resolveEntry(db, 'POST /orders'));
    expect(error.code).toBe(EXIT.failed);
    expect(error.details).toContain('  entry:gateway:http:POST:/orders');
    expect(error.details).toContain('  entry:orders:http:POST:/orders');
  });

  it('is narrowed by naming the service', () => {
    expect(resolveEntry(db, 'POST /orders', 'gateway').id).toBe('entry:gateway:http:POST:/orders');
  });

  it('suggests the nearest names when nothing matches, and fails', () => {
    const error = failure(() => resolveEntry(db, 'POST /order'));
    expect(error.code).toBe(EXIT.failed);
    expect(error.message).toBe('no entry matches "POST /order"');
    expect(error.details[0]).toBe('did you mean:');
  });
});

describe('naming a symbol', () => {
  it('takes a full node id as it stands', () => {
    const id = 'orders#src/orders/orders.service.ts:OrdersService.create';
    expect(resolveSymbol(db, id).id).toBe(id);
  });

  it('takes a bare Class.method while it means one thing', () => {
    expect(resolveSymbol(db, 'InvoicesService.create').repo).toBe('billing');
  });

  it('lists the candidates when the same Class.method exists in two repositories', () => {
    const error = failure(() => resolveSymbol(db, 'OrdersService.create'));
    expect(error.code).toBe(EXIT.failed);
    expect(error.details).toContain('  gateway#src/orders/orders.service.ts:OrdersService.create');
    expect(error.details).toContain('  orders#src/orders/orders.service.ts:OrdersService.create');
  });

  it('is narrowed by naming the service', () => {
    expect(resolveSymbol(db, 'OrdersService.create', 'orders').repo).toBe('orders');
  });

  it('fails when nothing resembles it', () => {
    expect(failure(() => resolveSymbol(db, 'NothingLikeThis')).code).toBe(EXIT.failed);
  });
});

describe('naming a channel', () => {
  it('accepts the name with or without the prefix', () => {
    expect(channelIdOf('order.created')).toBe('channel:order.created');
    expect(channelIdOf('channel:order.created')).toBe('channel:order.created');
    expect(resolveChannel(db, 'order.created').id).toBe('channel:order.created');
  });

  it('fails, with suggestions, when no channel goes by that name', () => {
    const error = failure(() => resolveChannel(db, 'order.'));
    expect(error.code).toBe(EXIT.failed);
    expect(error.details[0]).toBe('did you mean:');
  });
});
