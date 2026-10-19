/**
 * A hand-built bookshop for the export tests (P119): a browser, a gateway,
 * orders, billing, a functions-only service and one whose name a catalogue
 * cannot hold as written. Every crossing an export draws is here once, plus
 * the ones it must leave out.
 */
import type { Confidence, GraphEdge, GraphNode } from '@flowatlas/core';
import type { ExportGraph, ExportService } from '../joins.js';

const node = (id: string, type: GraphNode['type'], repo: string, extra: Partial<GraphNode> = {}): GraphNode => ({ id, type, label: extra.label ?? id, repo, ...extra });
const edge = (from: string, to: string, type: GraphEdge['type'], confidence: Confidence = 'static'): GraphEdge => ({ from, to, type, confidence });

const route = (service: string, method: string, path: string): GraphNode =>
  node(`entry:${service}:http:${method}:${path}`, 'entry', service, { kind: 'http', label: `${method} ${path}`, meta: { method, path } });

export const SERVICES: ExportService[] = [
  { name: 'web', type: 'angular', half: 'browser', catalog: { owner: 'team-storefront', lifecycle: 'production', system: 'bookshop' } },
  { name: 'gateway', type: 'nestjs', half: 'server', catalog: { owner: 'team-storefront', sourceUrl: 'https://example.com/bookshop/gateway' } },
  { name: 'orders', type: 'nestjs', half: 'server', catalog: { owner: 'team-orders', lifecycle: 'production', system: 'bookshop', description: 'Takes orders.' } },
  { name: 'billing', type: 'nestjs', half: 'server' },
  { name: 'jobs', type: 'lambda', half: 'server' },
  { name: 'Sales Ledger', type: 'nestjs', half: 'server' },
];

export const bookshop = (): ExportGraph => ({
  nodes: [
    ...['web', 'gateway', 'orders', 'billing', 'jobs', 'Sales Ledger'].map((name) => node(`repo:${name}`, 'repo', name)),
    route('gateway', 'GET', '/orders/:param'),
    route('orders', 'POST', '/orders'),
    route('orders', 'GET', '/orders/:param'),
    route('billing', 'POST', '/invoices'),
    node('entry:jobs:invoke:nightly-report', 'entry', 'jobs', { kind: 'invoke', label: 'nightly-report' }),
    node('ui_api_call:web#a.ts:1:1', 'ui_api_call', 'web', { label: 'GET /orders/:param', meta: { method: 'GET', path: '/orders/:param' } }),
    node('ui_api_call:web#a.ts:2:1', 'ui_api_call', 'web', { label: 'POST /orders' }),
    node('http_out:gateway#b.ts:1:1', 'http_out', 'gateway', { label: 'GET /orders/:param', meta: { method: 'GET', path: '/orders/:param' } }),
    node('http_out:gateway#b.ts:9:1', 'http_out', 'gateway', { label: 'POST /v1/charges', meta: { method: 'POST', path: '/v1/charges' } }),
    node('external_api:pay.example.com', 'external_api', 'gateway', { label: 'pay.example.com', meta: { host: 'pay.example.com' } }),
    node('producer:orders#c.ts:1:1', 'producer', 'orders', { label: 'event order.created' }),
    node('producer:orders#c.ts:2:1', 'producer', 'orders', { label: 'event order.shipped' }),
    node('channel:order.created', 'channel', 'orders', { label: 'order.created', meta: { channelKind: 'topic' } }),
    node('channel:order.shipped', 'channel', 'orders', { label: 'order.shipped' }),
    node('channel:invoice.requested', 'channel', 'billing', { label: 'invoice.requested' }),
    node('consumer:billing#d.ts:A.onCreated', 'consumer', 'billing', { label: 'A.onCreated' }),
    node('consumer:billing#d.ts:A.onRequested', 'consumer', 'billing', { label: 'A.onRequested' }),
    node('consumer:gateway#e.ts:B.onShipped', 'consumer', 'gateway', { label: 'B.onShipped' }),
    node('db_query:orders#f.ts:1:1', 'db_query', 'orders', { label: 'write orders', meta: { op: 'write' } }),
    node('db_query:orders#f.ts:2:1', 'db_query', 'orders', { label: 'read orders', meta: { op: 'read' } }),
    node('db_query:billing#g.ts:1:1', 'db_query', 'billing', { label: 'write orders', meta: { op: 'write' } }),
    node('db_query:billing#g.ts:2:1', 'db_query', 'billing', { label: 'read invoices', meta: { op: 'read' } }),
    node('table:orders#orders', 'table', 'orders', { label: 'orders' }),
    node('table:billing#orders', 'table', 'billing', { label: 'orders' }),
    node('table:billing#invoices', 'table', 'billing', { label: 'invoices' }),
    node('producer:billing#h.ts:1:1', 'producer', 'billing', { label: 'invoke nightly-report' }),
  ],
  edges: [
    edge('ui_api_call:web#a.ts:1:1', 'entry:gateway:http:GET:/orders/:param', 'hits'),
    // A guess: the browser naming orders directly. Left out unless asked for (I4).
    edge('ui_api_call:web#a.ts:2:1', 'entry:orders:http:POST:/orders', 'hits', 'heuristic'),
    edge('http_out:gateway#b.ts:1:1', 'entry:orders:http:GET:/orders/:param', 'http_calls', 'marker'),
    edge('http_out:gateway#b.ts:9:1', 'external_api:pay.example.com', 'calls'),
    edge('producer:orders#c.ts:1:1', 'channel:order.created', 'emits'),
    edge('producer:orders#c.ts:2:1', 'channel:order.shipped', 'emits'),
    edge('channel:order.created', 'consumer:billing#d.ts:A.onCreated', 'consumes'),
    edge('channel:invoice.requested', 'consumer:billing#d.ts:A.onRequested', 'consumes'),
    // A delivery matched by a pattern only: heuristic.
    edge('channel:order.shipped', 'consumer:gateway#e.ts:B.onShipped', 'consumes', 'heuristic'),
    edge('db_query:orders#f.ts:1:1', 'table:orders#orders', 'queries'),
    edge('db_query:orders#f.ts:2:1', 'table:orders#orders', 'queries'),
    edge('db_query:billing#g.ts:1:1', 'table:billing#orders', 'queries'),
    edge('db_query:billing#g.ts:2:1', 'table:billing#invoices', 'queries'),
    edge('producer:billing#h.ts:1:1', 'entry:jobs:invoke:nightly-report', 'calls'),
    // Inside one service: never a relation.
    edge('http_out:gateway#b.ts:1:1', 'entry:gateway:http:GET:/orders/:param', 'http_calls'),
  ],
});
