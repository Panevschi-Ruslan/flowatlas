import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { SCHEMA_VERSION, type GraphNode, type ProjectGraph } from '@flowatlas/core';
import { afterAll, describe, expect, it } from 'vitest';
import type { LinkReport } from '../report.js';
import { openGraphDb } from './reader.js';
import { GRAPH_DB_FORMAT_VERSION } from './schema.js';
import { queryWordsOf, wordsOf } from './words.js';
import { replaceService, writeGraphDb } from './writer.js';

const FIXED = '2026-01-01T00:00:00.000Z';
const dir = mkdtempSync(join(tmpdir(), 'flowatlas-words-'));

afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

const report = { schemaVersion: SCHEMA_VERSION, builtAt: FIXED, configHash: 'abc', services: [] } as unknown as LinkReport;

const method = (repo: string, file: string, label: string): GraphNode => ({ id: `${repo}#${file}:${label}`, type: 'method', label, repo, file, line: 1 });

const nodes: GraphNode[] = [
  { id: 'entry:shop:http:POST:/orders/:param/cancel', type: 'entry', kind: 'http', label: 'POST /orders/:param/cancel', repo: 'shop', file: 'src/orders.controller.ts', meta: { method: 'POST', path: '/orders/:param/cancel' } },
  { id: 'entry:shop:http:GET:/orders', type: 'entry', kind: 'http', label: 'GET /orders', repo: 'shop', file: 'src/orders.controller.ts', meta: { method: 'GET', path: '/orders' } },
  method('web', 'src/clients/orders.client.ts', 'OrdersClient.cancel'),
  method('web', 'src/clients/payments.client.ts', 'PaymentsClient.pay'),
  method('shop', 'src/orders.service.ts', 'OrdersService.findAll'),
  method('shop', 'src/cancellations/notes.ts', 'Notes.write'),
  { id: 'channel:order_created', type: 'channel', label: 'order_created', repo: 'shop' },
];

const project = (): ProjectGraph => ({
  schemaVersion: SCHEMA_VERSION,
  builtAt: FIXED,
  services: [],
  nodes,
  edges: [],
  types: { 'type:shop#CancelOrderDto': { name: 'CancelOrderDto', kind: 'object', declaredIn: 'shop#src/dto.ts', structuralHash: 'h', fields: [] } },
  unresolved: [],
});

const written = (name: string): string => {
  const path = join(dir, `${name}.db`);
  writeGraphDb(project(), report, path);
  return path;
};

describe('the words of a name (P383)', () => {
  it('splits camel, snake and kebab case and path segments, lower case', () => {
    expect(wordsOf('OrdersClient.cancel')).toEqual(['orders', 'client', 'cancel']);
    expect(wordsOf('HTTPServer')).toEqual(['http', 'server']);
    expect(wordsOf('POST /orders/:id/cancel')).toEqual(['post', 'orders', 'id', 'cancel']);
    expect(wordsOf('order_created desk-alerts')).toEqual(['order', 'created', 'desk', 'alerts']);
  });

  it('drops the words a question is written with, and keeps a query of nothing else whole', () => {
    expect(queryWordsOf('where is the order cancelled')).toEqual(['order', 'cancelled']);
    expect(queryWordsOf('cancelOrder')).toEqual(['cancel', 'order']);
    expect(queryWordsOf('cancel OR archive')).toEqual(['cancel', 'archive']);
    expect(queryWordsOf('what is it')).toEqual(['what', 'is', 'it']);
  });
});

describe('searching by words', () => {
  it('stores the words with the graph and finds a sentence, the most words in the name first', () => {
    const db = openGraphDb(written('sentence'));
    expect(db.formatVersion()).toBe(GRAPH_DB_FORMAT_VERSION);
    expect(db.wordsStored()).toBe(true);
    const { words, hits } = db.searchWords('where is the order cancelled');
    expect(words).toEqual(['order', 'cancelled']);
    // Stemmed: cancelled meets cancel, order meets orders.
    // Every name holding both words first (the type too: which kind leads is the tools' tie-break).
    expect(hits.slice(0, 3).map((hit) => hit.id).sort()).toEqual(['entry:shop:http:POST:/orders/:param/cancel', 'type:shop#CancelOrderDto', 'web#src/clients/orders.client.ts:OrdersClient.cancel']);
    expect(hits[0]!.matched).toEqual(['order', 'cancelled']);
    // A file's words count, but below a name's: the cancellations folder holds Notes.write.
    const notes = hits.find((hit) => hit.id.endsWith('Notes.write'));
    expect(notes?.inName).toBe(0);
    expect(hits.indexOf(notes!)).toBeGreaterThan(2);
    db.close();
  });

  it('finds a declared type and a plural asked in the singular', () => {
    const db = openGraphDb(written('plural'));
    expect(db.searchWords('cancel order dto').hits[0]?.id).toBe('type:shop#CancelOrderDto');
    expect(db.searchWords('what handles payments').hits[0]?.id).toBe('web#src/clients/payments.client.ts:PaymentsClient.pay');
    expect(db.searchWords('nothing here at all zzz').hits.filter((hit) => hit.matched.includes('zzz'))).toEqual([]);
    db.close();
  });

  it('indexes a database written before the words were stored, in memory, the same way', () => {
    const path = written('older');
    const raw = new Database(path);
    raw.exec('DROP TABLE words');
    raw.prepare("UPDATE meta SET value = '2' WHERE key = 'db_format_version'").run();
    raw.close();
    const stored = openGraphDb(written('newer'));
    const older = openGraphDb(path);
    expect(older.wordsStored()).toBe(false);
    expect(older.searchWords('order cancel').hits).toEqual(stored.searchWords('order cancel').hits);
    older.close();
    stored.close();
  });

  it('replaces one service’s words with its nodes', () => {
    const path = written('replace');
    const raw = new Database(path);
    replaceService(raw, 'web', { schemaVersion: SCHEMA_VERSION, repo: 'web', generatedAt: FIXED, nodes: [method('web', 'src/refunds.ts', 'RefundsClient.request')], edges: [], types: {}, unresolved: [] });
    raw.close();
    const db = openGraphDb(path);
    expect(db.searchWords('orders client').hits.map((hit) => hit.id)).not.toContain('web#src/clients/orders.client.ts:OrdersClient.cancel');
    expect(db.searchWords('refund request').hits[0]?.id).toBe('web#src/refunds.ts:RefundsClient.request');
    db.close();
  });
});
