import { AdapterRegistry, GraphBuilder, noAdapters, parseConfig, silentLogger, type ExtractContext, type GraphNode, type RepoGraph } from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { plainBrowserAdapter, registerFrontendAdapters } from './adapter.js';
import { forcedFor, PLAIN_BROWSER_ADAPTER, PLAIN_BROWSER_TYPE } from './framework.js';

/** Pages' scripts written in memory, read by the plain adapter as the build would hand them over (P284). */
const read = (files: Record<string, string>): RepoGraph => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: true, checkJs: false, strict: false } });
  for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);
  const builder = new GraphBuilder({ repo: 'web' });
  const ctx: ExtractContext = {
    repo: 'web',
    repoDir: '/',
    service: { name: 'web', repo: '/', type: PLAIN_BROWSER_TYPE },
    config: parseConfig({}),
    pkg: {},
    project,
    checker: project.getTypeChecker(),
    builder,
    adapters: { ...noAdapters, frontend: [plainBrowserAdapter] },
    logger: silentLogger,
  };
  plainBrowserAdapter.extract(ctx, { noTypes: true });
  return builder.build();
};

const requests = (graph: RepoGraph): GraphNode[] => graph.nodes.filter((node) => node.type === 'ui_api_call');

describe('plain browser code (P284)', () => {
  it('reads a request in one script whose address another script of the page declares', () => {
    const graph = read({
      '/js/config.js': "const API_ROOT = 'https://api.example.test';\nconst ORDERS = `${API_ROOT}/orders`;\n",
      '/js/orders.js': "async function place(order) {\n  return fetch(ORDERS, { method: 'POST', body: JSON.stringify(order) });\n}\n",
    });
    expect(requests(graph).map((node) => [node.file, node.meta?.['method'], node.meta?.['url']])).toEqual([['js/orders.js', 'POST', 'https://api.example.test/orders']]);
  });

  it('reads the verb and the address an XMLHttpRequest is opened with', () => {
    const graph = read({
      '/js/cancel.js': "function cancel(id) {\n  const request = new XMLHttpRequest();\n  request.open('delete', `https://api.example.test/orders/${id}`);\n  request.send();\n}\n",
    });
    expect(requests(graph).map((node) => [node.meta?.['client'], node.meta?.['method'], node.meta?.['path']])).toEqual([['xhr', 'DELETE', '/orders/:param']]);
  });

  it('reads the body an XMLHttpRequest is sent after it is opened, as a fetch body is read (P294)', () => {
    const graph = read({
      '/js/send.js': [
        'function place(order) {',
        '  const request = new XMLHttpRequest();',
        "  request.open('POST', 'https://api.example.test/orders');",
        "  request.setRequestHeader('Content-Type', 'application/json');",
        '  request.send(JSON.stringify({ item: order.item, quantity: 2 }));',
        '}',
        'function upload(file) {',
        '  const form = new FormData();',
        "  form.append('file', file);",
        '  const request = new XMLHttpRequest();',
        "  request.open('PUT', 'https://api.example.test/files');",
        '  request.send(form);',
        '}',
        "const NOTE = { text: 'hello' };",
        'function note() {',
        '  const request = new XMLHttpRequest();',
        "  request.open('POST', 'https://api.example.test/notes');",
        '  request.send(JSON.stringify(NOTE));',
        '}',
        'function ping() {',
        '  const request = new XMLHttpRequest();',
        "  request.open('GET', 'https://api.example.test/ping');",
        '  request.send();',
        '}',
      ].join('\n'),
    });
    const found = requests(graph).map((node) => [node.meta?.['method'], node.meta?.['path'], node.meta?.['bodyType'], node.meta?.['bodyKeys']]);
    expect(found.sort((a, b) => String(a[1]).localeCompare(String(b[1])))).toEqual([
      ['PUT', '/files', 'FormData', undefined],
      ['POST', '/notes', '{text:string}', undefined],
      ['POST', '/orders', '{item:any;quantity:number}', ['item', 'quantity']],
      ['GET', '/ping', null, undefined],
    ]);
  });

  it('follows the receiver to where a request opened in one function is sent in another (P296)', () => {
    const graph = read({
      '/js/later.js': [
        'function opened() {',
        '  const request = new XMLHttpRequest();',
        "  request.open('POST', 'https://api.example.test/orders');",
        '  return request;',
        '}',
        'function place(order) {',
        '  const sent = opened();',
        '  sent.send(JSON.stringify({ item: order.item }));',
        '}',
        'function deliver(request, note) {',
        '  request.send(JSON.stringify({ text: note }));',
        '}',
        'function write(note) {',
        '  const request = new XMLHttpRequest();',
        "  request.open('POST', 'https://api.example.test/notes');",
        '  deliver(request, note);',
        '}',
        'const shared = new XMLHttpRequest();',
        "function begin() { shared.open('POST', 'https://api.example.test/pings'); }",
        "function end() { shared.send(JSON.stringify({ at: 1 })); }",
      ].join('\n'),
    });
    const found = requests(graph).map((node) => [node.meta?.['path'], node.meta?.['bodyKeys']]);
    expect(found.sort((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual([
      ['/notes', ['text']],
      ['/orders', ['item']],
      ['/pings', ['at']],
    ]);
  });

  it('reads a request on a receiver handed in, by what each caller hands it and sends after (P301)', () => {
    const graph = read({
      '/js/handed.js': [
        'function start(request, id) {',
        "  request.open('POST', `https://api.example.test/orders/${id}/notes`);",
        '}',
        'function note(id, text) {',
        '  const request = new XMLHttpRequest();',
        '  start(request, id);',
        '  request.send(JSON.stringify({ text }));',
        '}',
        'function load(xhr, url) {',
        "  xhr.open('GET', url);",
        '  xhr.send();',
        '}',
        "function items() { load(new XMLHttpRequest(), 'https://api.example.test/items'); }",
        "function nobody(thing) { thing.open('GET', 'https://api.example.test/never'); }",
        'const popup = { open() {} };',
        "function show(target) { target.open('GET', 'https://api.example.test/popup'); }",
        'show(popup);',
      ].join('\n'),
    });
    const found = requests(graph).map((node) => [node.meta?.['method'], node.meta?.['path'], node.meta?.['bodyKeys']]);
    expect(found.sort((a, b) => String(a[1]).localeCompare(String(b[1])))).toEqual([
      ['GET', '/items', undefined],
      ['POST', '/orders/:param/notes', ['text']],
    ]);
  });

  it('reads a request opened on a field the compiler knows nothing of, by what the class gives it (P301)', () => {
    const graph = read({
      '/js/fields.js': [
        "import axios from 'axios';",
        "const shop = axios.create({ baseURL: 'https://shop.example.test/api' });",
        'class Uploader {',
        '  request = null;',
        '  begin() {',
        '    this.request = new XMLHttpRequest();',
        "    this.request.open('PUT', 'https://files.example.test/files');",
        '  }',
        '  finish(file) { this.request.send(file); }',
        '}',
        'class Poller {',
        '  constructor(request) { this.request = request; }',
        "  poll() { this.request.open('GET', 'https://api.example.test/status'); this.request.send(); }",
        '}',
        'new Poller(new XMLHttpRequest());',
        'class Catalog {',
        '  constructor(client) { this.client = client; }',
        "  list() { return this.client.get('/products'); }",
        '}',
        'new Catalog(shop);',
        'class Cart {',
        '  constructor() { this.client = null; }',
        "  connect() { this.client = axios.create({ baseURL: 'https://shop.example.test/api' }); }",
        "  lines() { return this.client.get('/cart'); }",
        '}',
        'class Window {',
        '  constructor(target) { this.target = target; }',
        "  show() { this.target.open('GET', 'https://api.example.test/never'); }",
        '}',
        'new Window({ open() {} });',
      ].join('\n'),
    });
    const found = requests(graph).map((node) => [node.meta?.['method'], node.meta?.['url'], node.meta?.['bodyType']]);
    expect(found.sort((a, b) => String(a[1]).localeCompare(String(b[1])))).toEqual([
      ['GET', 'https://api.example.test/status', null],
      ['PUT', 'https://files.example.test/files', 'any'],
      ['GET', 'https://shop.example.test/api/cart', null],
      ['GET', 'https://shop.example.test/api/products', null],
    ]);
  });

  it('reads an instance a parameter property is handed where its type is not installed (P301)', () => {
    const graph = read({
      '/src/reviews.ts': [
        "import axios, { type AxiosInstance } from 'axios';",
        "const reviews = axios.create({ baseURL: 'https://reviews.example.test' });",
        'export class ReviewList {',
        '  constructor(private readonly http: AxiosInstance) {}',
        "  latest() { return this.http.get('/latest'); }",
        '}',
        'export const list = new ReviewList(reviews);',
      ].join('\n'),
    });
    expect(requests(graph).map((node) => node.meta?.['url'])).toEqual(['https://reviews.example.test/latest']);
  });

  it('leaves a verb it cannot read as unread', () => {
    const graph = read({ '/js/any.js': "function send(verb) {\n  const request = new XMLHttpRequest();\n  request.open(verb, 'https://api.example.test/orders');\n}\n" });
    expect(requests(graph).map((node) => node.meta?.['method'])).toEqual([null]);
    expect(graph.unresolved.map((row) => row.reason)).toContain('api-method-dynamic');
  });

  it('is chosen by the type alone: no manifest gives it away, and a forced adapter is kept', () => {
    const registry = registerFrontendAdapters(new AdapterRegistry());
    expect(registry.detect({}).frontend.map((adapter) => adapter.name)).toEqual([]);
    expect(registry.detect({}, forcedFor(PLAIN_BROWSER_TYPE, {})).frontend.map((adapter) => adapter.name)).toEqual([PLAIN_BROWSER_ADAPTER]);
    expect(forcedFor('react', {})).toEqual({});
    expect(forcedFor(PLAIN_BROWSER_TYPE, { frontend: ['react'] })).toEqual({ frontend: ['react'] });
  });
});
