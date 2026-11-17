import { AdapterRegistry, GraphBuilder, noAdapters, parseConfig, silentLogger, type ExtractContext, type GraphNode, type RepoGraph } from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { plainBrowserAdapter, registerFrontendAdapters } from './adapter.js';
import { forcedFor, PLAIN_BROWSER_ADAPTER, PLAIN_BROWSER_TYPE } from './framework.js';

/** Pages' scripts written in memory, read by the plain adapter as the build would hand them over (P284). */
const read = (files: Record<string, string>, pages: Record<string, string> = {}, repoDir = '/'): RepoGraph => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: true, checkJs: false, strict: false } });
  for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);
  // The pages that load them, beside them on the project's file system (P310).
  for (const [path, html] of Object.entries(pages)) project.getFileSystem().writeFileSync(path, html);
  const builder = new GraphBuilder({ repo: 'web' });
  const ctx: ExtractContext = {
    repo: 'web',
    repoDir,
    service: { name: 'web', repo: repoDir, type: PLAIN_BROWSER_TYPE },
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

  it('follows a path a parameter puts straight after a host out to each caller, and leaves one nobody hands unread, never the root (P308)', () => {
    const graph = read({
      '/js/api.js': [
        "function getJson(path) { return fetch('https://shop.example.test' + path); }",
        'function postJson(path, body) { return fetch(`https://shop.example.test${path}`, { method: \'POST\', body }); }',
        "function products() { return getJson('/products'); }",
        'function product(id) { return getJson(`/products/${id}`); }',
        "function order(body) { return postJson('/orders', body); }",
        "function lost(path) { return fetch('https://shop.example.test' + path); }",
      ].join('\n'),
    });
    expect(requests(graph).map((node) => [node.meta?.['method'], node.meta?.['host'], node.meta?.['path']]).sort()).toEqual([
      ['GET', 'shop.example.test', '${…}'],
      ['GET', 'shop.example.test', '/products'],
      ['GET', 'shop.example.test', '/products/:param'],
      ['POST', 'shop.example.test', '/orders'],
    ]);
    expect(graph.unresolved.filter((row) => row.reason === 'api-path-dynamic').map((row) => row.line)).toEqual([6]);
  });

  it('reads a receiver handed through a function that sends it, one request per caller handing an instance with its own base, and a value after a host by what it is (P312)', () => {
    const graph = read({
      '/js/api.js': [
        "import axios from 'axios';",
        "function start(request) { request.open('POST', 'https://notes.example.test/notes'); }",
        'function middle(r, text) { start(r); r.send(JSON.stringify({ text })); }',
        "function note() { const request = new XMLHttpRequest(); middle(request, 'hello'); }",
        "function latest(client) { return client.get('/latest'); }",
        "function reviews() { return latest(axios.create({ baseURL: 'https://reviews.example.test' })); }",
        "function ratings() { return latest(axios.create({ baseURL: 'https://ratings.example.test' })); }",
        'function versioned(version) { return fetch(`https://shop.example.test${version}/products`); }',
        "function first() { return versioned('/v1'); }",
        "function second() { return versioned('/v2'); }",
        'function local(port) { return fetch(`http://localhost${port}/health`); }',
        "function check() { return local(':8080'); }",
        "function lost(z) { return fetch('https://shop.example.test' + z + '/lost'); }",
      ].join('\n'),
    });
    const found = requests(graph).map((node) => [node.meta?.['method'], node.meta?.['host'], node.meta?.['path'], node.meta?.['bodyKeys'], node.meta?.['through']]);
    expect(found.sort((a, b) => `${a[1]}${a[2]}`.localeCompare(`${b[1]}${b[2]}`))).toEqual([
      // Every caller hands a port: one request per caller, at its port (P318).
      ['GET', 'localhost:8080', '/health', undefined, 'local'],
      ['POST', 'notes.example.test', '/notes', ['text'], undefined],
      ['GET', 'ratings.example.test', '/latest', undefined, 'latest'],
      ['GET', 'reviews.example.test', '/latest', undefined, 'latest'],
      ['GET', 'shop.example.test', '/${…}/lost', undefined, undefined],
      ['GET', 'shop.example.test', '/v1/products', undefined, 'versioned'],
      ['GET', 'shop.example.test', '/v2/products', undefined, 'versioned'],
    ]);
    expect(graph.unresolved.filter((row) => row.reason === 'api-path-dynamic').map((row) => row.line)).toEqual([13]);
  });

  it('reads a port each caller hands as one request per caller at its port, a host a method answers with a port a class keeps, and instances along an address followed out (P318)', () => {
    const graph = read({
      '/js/api.js': [
        "import axios from 'axios';",
        'function health(port) { return fetch(`http://localhost:${port}/health`); }',
        'function one() { return health(4600); }',
        "function two() { return health('4700'); }",
        'function ping(port) { return fetch(`http://localhost${port}/ping`); }',
        "function three() { return ping(':4800'); }",
        'class Ports { static kept = \':4900\'; }',
        "class Probe { origin() { return 'http://localhost'; } check(port) { return fetch(`${this.origin()}${port}/probe`); } }",
        'function four() { return new Probe().check(Ports.kept); }',
        'new Probe().check(Ports.kept);',
        'function readWith(client, path) { return client.get(path); }',
        "function five() { return readWith(axios.create({ baseURL: 'http://localhost:5000' }), '/latest'); }",
        "function six() { return readWith(axios.create({ baseURL: 'http://localhost:5100' }), '/levels'); }",
        "function seven(client) { return readWith(client, '/stock'); }",
        "function eight() { return seven(axios.create({ baseURL: 'http://localhost:5200' })); }",
      ].join('\n'),
    });
    const found = requests(graph).map((node) => [node.meta?.['host'], node.meta?.['path'], node.meta?.['through']]);
    expect(found.sort((a, b) => `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`))).toEqual([
      ['localhost:4600', '/health', 'health'],
      ['localhost:4700', '/health', 'health'],
      ['localhost:4800', '/ping', 'ping'],
      ['localhost:4900', '/probe', 'Probe.check'],
      // Checked at the top of the script, which is a function of its own (P334): drawn from it at its port.
      ['localhost:4900', '/probe', 'Probe.check'],
      ['localhost:5000', '/latest', 'readWith'],
      ['localhost:5100', '/levels', 'readWith'],
      ['localhost:5200', '/stock', 'readWith'],
    ]);
    expect(graph.unresolved.filter((row) => row.reason === 'api-path-dynamic' || row.reason === 'api-client-base-unread')).toEqual([]);
  });

  it('keeps a port no caller reads where the request is written, and a number anywhere but the port place the path\'s (P318)', () => {
    const graph = read({
      '/js/api.js': [
        'function health(port) { return fetch(`http://localhost:${port}/health`); }',
        'function one() { return health(4600); }',
        'function two(settings) { return health(settings.port); }',
        'function order(id) { return fetch(`http://localhost:4600/orders/${id}`); }',
        'function first() { return order(42); }',
      ].join('\n'),
    });
    const found = requests(graph).map((node) => [node.meta?.['host'], node.meta?.['path']]);
    expect(found.sort((a, b) => `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`))).toEqual([
      ['localhost:${…}', '/health'],
      ['localhost:4600', '/health'],
      ['localhost:4600', '/orders/:param'],
    ]);
  });

  it('reads a number a class or a module keeps in a port place, handed or written there, and never one in the path\'s place (P324)', () => {
    const graph = read({
      '/js/api.js': [
        'class Ports { static stock = 4700; static get catalog() { return 4600; } }',
        'class Local { constructor() { this.port = 4800; } url() { return fetch(`http://localhost:${this.port}/local`); } }',
        'class Paging { static size = 20; }',
        'const KEPT = 4900;',
        'function health(port) { return fetch(`http://localhost:${port}/health`); }',
        'function one() { return health(Ports.stock); }',
        'function two() { return health(Ports.catalog); }',
        'function three() { return health(KEPT); }',
        'function levels() { return fetch(`http://localhost:${Ports.stock}/levels`); }',
        'function page() { return fetch(`http://localhost:4600/latest/${Paging.size}`); }',
      ].join('\n'),
    });
    const found = requests(graph).map((node) => [node.meta?.['host'], node.meta?.['path']]);
    expect(found.sort((a, b) => `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`))).toEqual([
      ['localhost:4600', '/health'],
      ['localhost:4600', '/latest/:param'],
      ['localhost:4700', '/health'],
      ['localhost:4700', '/levels'],
      ['localhost:4800', '/local'],
      ['localhost:4900', '/health'],
    ]);
  });

  it('reads a number straight after a host with no colon as the code spells it and says so, and a port handed with its colon as the port (P324)', () => {
    const graph = read({
      '/js/api.js': [
        'function probe(port) { return fetch(`http://localhost${port}/health`); }',
        'function one() { return probe(4600); }',
        "function two() { return probe(':4700'); }",
        'const PORT = 4800;',
        "function three() { return fetch('http://127.0.0.1' + PORT + '/ping'); }",
        'function four(n) { return fetch(`http://worker${n}/jobs`); }',
        'function five() { return four(3); }',
      ].join('\n'),
    });
    const found = requests(graph).map((node) => [node.meta?.['host'], node.meta?.['path']]);
    expect(found.sort((a, b) => `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`))).toEqual([
      ['127.0.0.14800', '/ping'],
      ['localhost:4700', '/health'],
      ['localhost4600', '/health'],
      ['worker3', '/jobs'],
    ]);
    const rows = graph.unresolved.filter((row) => row.reason === 'address-port-without-colon');
    expect(rows.map((row) => [row.line, row.level ?? 'action', row.meta?.['host'], row.meta?.['number']]).sort()).toEqual([
      [2, 'action', 'localhost', '4600'],
      [5, 'action', '127.0.0.1', '4800'],
      [7, 'info', 'worker', '3'],
    ]);
    // The request carries what was glued, for the linker to join no path to it (P330).
    expect(requests(graph).flatMap((node) => (node.meta?.['portWithoutColon'] === undefined ? [] : [node.meta['portWithoutColon']]))).toEqual(
      expect.arrayContaining([{ number: '4600', host: 'localhost' }, { number: '4800', host: '127.0.0.1' }, { number: '3', host: 'worker' }]),
    );
  });

  it('reads instances a field its type names a client is handed at each caller under its base, the type alone where they are not read (P330)', () => {
    const graph = read({
      // The client's own types, installed, so `AxiosInstance` is known for what it is.
      '/node_modules/axios/package.json': '{ "name": "axios", "types": "index.d.ts" }',
      '/node_modules/axios/index.d.ts': [
        'export interface AxiosInstance { get(url: string, config?: unknown): Promise<unknown>; post(url: string, data?: unknown): Promise<unknown>; }',
        'export interface AxiosStatic extends AxiosInstance { create(config?: { baseURL?: string }): AxiosInstance; }',
        'declare const axios: AxiosStatic;',
        'export default axios;',
      ].join('\n'),
      '/src/typed.ts': [
        "import axios, { type AxiosInstance } from 'axios';",
        "const ordersApi = axios.create({ baseURL: 'http://localhost:5000' });",
        "const usersApi = axios.create({ baseURL: 'http://localhost:5100' });",
        'class Service {',
        '  constructor(private api: AxiosInstance) {}',
        '  send(path: string) { return this.api.get(path); }',
        "  all() { return this.api.get('/all'); }",
        '}',
        "export const orders = () => new Service(ordersApi).send('/orders');",
        "export const users = () => new Service(usersApi).send('/users');",
        'export const allOrders = () => new Service(ordersApi).all();',
        'export const allUsers = () => new Service(usersApi).all();',
        'class Single {',
        '  private http: AxiosInstance;',
        '  constructor(http: AxiosInstance) { this.http = http; }',
        "  ping() { return this.http.get('/ping'); }",
        '}',
        'export const single = new Single(ordersApi);',
        // Handed nothing anyone reads: the client by its type, the path alone.
        "export const free = (api: AxiosInstance) => api.get('/free');",
      ].join('\n'),
    });
    const found = requests(graph).map((node) => [node.meta?.['host'] ?? null, node.meta?.['path'], node.meta?.['client']]);
    expect(found.sort((a, b) => `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`))).toEqual([
      ['localhost:5000', '/all', 'axios'],
      ['localhost:5000', '/orders', 'axios'],
      ['localhost:5000', '/ping', 'axios'],
      ['localhost:5100', '/all', 'axios'],
      ['localhost:5100', '/users', 'axios'],
      [null, '/free', 'axios'],
    ]);
    expect(graph.unresolved.filter((row) => row.reason === 'api-client-base-unread')).toEqual([]);
  });

  it('follows a caller that calls the method on an instance it was handed out to whoever makes it, each under its base (P330)', () => {
    const graph = read({
      '/src/api.ts': [
        "import axios from 'axios';",
        "const catalogApi = axios.create({ baseURL: 'http://localhost:4600' });",
        "const stockApi = axios.create({ baseURL: 'http://localhost:4700' });",
        'class Reader {',
        '  constructor(private api) {}',
        '  read(path: string) { return this.api.get(path); }',
        "  health() { return this.read('/health'); }",
        '}',
        // A parameter the instance is handed in.
        'function check(reader: Reader) { return reader.health(); }',
        'export function one() { return check(new Reader(catalogApi)); }',
        'export function two() { const reader = new Reader(stockApi); return check(reader); }',
        "function levels(reader: Reader) { return reader.read('/levels'); }",
        'export function three() { return levels(new Reader(stockApi)); }',
        // A field of the caller's own `this`.
        'class Board {',
        '  private reader: Reader;',
        '  constructor(reader: Reader) { this.reader = reader; }',
        '  show() { return this.reader.health(); }',
        '}',
        'export function four() { return new Board(new Reader(catalogApi)).show(); }',
        'export function five() { return new Board(new Reader(stockApi)).show(); }',
        // A `new` handed the instance by its own caller.
        'function relay(api) { return new Reader(api).health(); }',
        'export function six() { return relay(catalogApi); }',
      ].join('\n'),
    });
    const label = (id: string): string | undefined => graph.nodes.find((node) => node.id === id)?.label;
    const found = requests(graph).map((node) => [label(graph.edges.find((edge) => edge.to === node.id && edge.type === 'calls')?.from ?? ''), node.meta?.['host'], node.meta?.['path']]);
    expect(found.map((each) => each.join(' ')).sort()).toEqual([
      'five localhost:4700 /health',
      'four localhost:4600 /health',
      'one localhost:4600 /health',
      'six localhost:4600 /health',
      'three localhost:4700 /levels',
      'two localhost:4700 /health',
    ]);
    expect(graph.unresolved.filter((row) => row.reason === 'api-client-base-unread')).toEqual([]);
  });

  it('reads instances held in a field the constructor fills, or a member of an object handed in, at each caller under its base (P324)', () => {
    const graph = read({
      '/js/api.js': [
        "import axios from 'axios';",
        "const catalogApi = axios.create({ baseURL: 'http://localhost:4600' });",
        "const stockApi = axios.create({ baseURL: 'http://localhost:4700' });",
        'class Reader {',
        '  constructor(api) { this.api = api; }',
        '  read(path) { return this.api.get(path); }',
        "  health() { return this.read('/health'); }",
        '}',
        "function one() { return new Reader(catalogApi).read('/latest'); }",
        "function two() { const reader = new Reader(stockApi); return reader.read('/levels'); }",
        'function three() { return new Reader(stockApi).health(); }',
        'function readOn(options, path) { return options.client.get(path); }',
        "function four() { return readOn({ client: catalogApi }, '/latest'); }",
        "function five() { const client = stockApi; return readOn({ client }, '/levels'); }",
        "class Catalog { constructor(client) { this.client = client; } list() { return this.client.get('/products'); } }",
        'function six() { return new Catalog(catalogApi).list(); }',
        'function seven() { const catalog = new Catalog(stockApi); return catalog.list(); }',
      ].join('\n'),
      // A parameter property fills the field as `this.api = api` does.
      '/js/typed.ts': [
        "import axios from 'axios';",
        "const ordersApi = axios.create({ baseURL: 'http://localhost:5000' });",
        "const usersApi = axios.create({ baseURL: 'http://localhost:5100' });",
        'class Service { constructor(private api) {} send(path: string) { return this.api.get(path); } }',
        "export const orders = () => new Service(ordersApi).send('/orders');",
        "export const users = () => new Service(usersApi).send('/users');",
      ].join('\n'),
    });
    const found = requests(graph).map((node) => [node.meta?.['host'], node.meta?.['path'], node.meta?.['through']]);
    expect(found.sort((a, b) => `${a[0]}${a[1]}${a[2]}`.localeCompare(`${b[0]}${b[1]}${b[2]}`))).toEqual([
      ['localhost:4600', '/latest', 'Reader.read'],
      ['localhost:4600', '/latest', 'readOn'],
      // Written in place in `list`: at each caller, the instance it calls `list` on.
      ['localhost:4600', '/products', 'Catalog.list'],
      // Followed out of `health` through `this.read`, to the instance `three` calls it on.
      ['localhost:4700', '/health', 'Reader.read'],
      ['localhost:4700', '/levels', 'Reader.read'],
      ['localhost:4700', '/levels', 'readOn'],
      ['localhost:4700', '/products', 'Catalog.list'],
      ['localhost:5000', '/orders', 'Service.send'],
      ['localhost:5100', '/users', 'Service.send'],
    ]);
    expect(graph.unresolved.filter((row) => row.reason === 'api-client-base-unread')).toEqual([]);
  });

  it('keeps instances with different bases handed outside any function on the request, the path alone, and says so (P312)', () => {
    const graph = read({
      '/js/catalog.js': [
        "import axios from 'axios';",
        'class Catalog {',
        '  constructor(client) { this.client = client; }',
        "  list() { return this.client.get('/products'); }",
        '}',
        "new Catalog(axios.create({ baseURL: 'https://one.example.test' }));",
        "new Catalog(axios.create({ baseURL: 'https://two.example.test' }));",
      ].join('\n'),
    });
    expect(requests(graph).map((node) => node.meta?.['url'])).toEqual(['/products']);
    expect(graph.unresolved.filter((row) => row.reason === 'api-client-base-unread').map((row) => row.line)).toEqual([4]);
  });

  it("reads a request in an object's method and a prototype's member, and joins the calls to them (P310)", () => {
    const graph = read({
      '/js/api.js': [
        'const api = {',
        '  load() {',
        '    const xhr = new XMLHttpRequest();',
        "    xhr.open('GET', 'https://api.example.test/items');",
        '    xhr.send();',
        '  },',
        "  remove: function (id) { return fetch(`https://api.example.test/items/${id}`, { method: 'DELETE' }); },",
        "  users: { list: () => fetch('https://api.example.test/users') },",
        '};',
        'function Store(base) { this.base = base; }',
        "Store.prototype.save = function (item) { return fetch('https://api.example.test/items', { method: 'POST', body: JSON.stringify(item) }); };",
        'Store.prototype.saveAll = function (items) { items.forEach((item) => this.save(item)); };',
        'function Pager() {}',
        "Object.assign(Pager.prototype, { next() { return fetch('https://api.example.test/pages/next'); } });",
        'function get(url) { return fetch(url); }',
        "const views = { recent() { return get('https://api.example.test/views'); } };",
      ].join('\n'),
      '/js/page.js': [
        'function start() {',
        '  api.load();',
        '  api.users.list();',
        "  const store = new Store('https://api.example.test');",
        '  store.saveAll([]);',
        '  const pager = new Pager();',
        '  pager.next();',
        '}',
      ].join('\n'),
      '/js/settings.js': "export default {\n  fetchUsers() { return fetch('https://api.example.test/settings'); },\n};\n",
    });
    const label = (id: string): string | undefined => graph.nodes.find((node) => node.id === id)?.label;
    const found = requests(graph).map((node) => [label(graph.edges.find((edge) => edge.to === node.id)?.from ?? ''), node.meta?.['method'], node.meta?.['path']]);
    expect(found.map((each) => each.join(' ')).sort()).toEqual([
      'Pager.next GET /pages/next',
      'Store.save POST /items',
      'api.load GET /items',
      'api.remove DELETE /items/:param',
      'api.users.list GET /users',
      'default.fetchUsers GET /settings',
      'views.recent GET /views',
    ]);
    const isFunction = (id: string): boolean => graph.nodes.find((node) => node.id === id)?.type === 'function';
    const calls = graph.edges.filter((edge) => edge.type === 'calls' && isFunction(edge.to)).map((edge) => `${label(edge.from)} -> ${label(edge.to)}`);
    expect(calls.sort()).toEqual(['Store.saveAll -> Store.save', 'start -> Pager.next', 'start -> Store.saveAll', 'start -> api.load', 'start -> api.users.list', 'views.recent -> get']);
  });

  it('reads axios as the installed client where a page loads it by a script tag or the script declares it (P310)', () => {
    const script = "function items() { return axios.get('https://api.example.test/items'); }\nconst shop = axios.create({ baseURL: 'https://shop.example.test/api' });\nfunction cart() { return shop.post('/cart', { item: 1 }); }\n";
    const urls = (graph: RepoGraph): unknown[] => requests(graph).map((node) => node.meta?.['url']).sort();
    const both = ['https://api.example.test/items', 'https://shop.example.test/api/cart'];
    expect(urls(read({ '/js/shop.js': script }, { '/index.html': '<html><head><script src="https://cdn.example.test/npm/axios@1.7.2/dist/axios.min.js"></script><script src="js/shop.js"></script></head></html>' }))).toEqual(both);
    expect(urls(read({ '/js/shop.js': script }, { '/pages/cart.html': "<script src='../vendor/axios.min.js'></script>" }))).toEqual(both);
    expect(urls(read({ '/js/shop.js': `/* global axios */\n${script}` }))).toEqual(both);
    // Nothing loads it, or the page loads a plugin of it: a name nothing says is the client.
    expect(urls(read({ '/js/shop.js': script }))).toEqual([]);
    expect(urls(read({ '/js/shop.js': script }, { '/index.html': '<script src="https://cdn.example.test/npm/axios-retry/dist/index.js"></script>' }))).toEqual([]);
    // A name the repository declares is its own, whatever the page loads.
    const own = "const axios = { get(path) { return path; } };\nfunction items() { return axios.get('https://api.example.test/items'); }\n";
    expect(urls(read({ '/js/own.js': own }, { '/index.html': '<script src="vendor/axios.js"></script>' }))).toEqual([]);
  });

  /** Each request as `<function it is drawn from> <verb> <path>`, and each call between functions as `<from> -> <to>`. */
  const drawn = (graph: RepoGraph): { found: string[]; calls: string[] } => {
    const label = (id: string): string | undefined => graph.nodes.find((node) => node.id === id)?.label;
    const isFunction = (id: string): boolean => graph.nodes.find((node) => node.id === id)?.type === 'function';
    return {
      found: requests(graph)
        .map((node) => `${label(graph.edges.find((edge) => edge.to === node.id)?.from ?? '')} ${node.meta?.['method']} ${node.meta?.['path']}`)
        .sort(),
      calls: graph.edges
        .filter((edge) => edge.type === 'calls' && isFunction(edge.to))
        .map((edge) => `${label(edge.from)} -> ${label(edge.to)}`)
        .sort(),
    };
  };

  it('reads the functions and members a wrapper run at once keeps, and joins calls through what it hands the page or returns (P311)', () => {
    const graph = read({
      '/js/shop.js': [
        '(function () {',
        "  const api = { load() { return fetch('https://api.example.test/items'); } };",
        '  function Store() {}',
        "  Store.prototype.save = function (item) { return fetch('https://api.example.test/items', { method: 'POST', body: JSON.stringify(item) }); };",
        "  function init() { return fetch('https://api.example.test/init'); }",
        '  window.api = api;',
        '  window.Store = Store;',
        '})();',
        "!function () { function init() { return fetch('https://api.example.test/other'); } }();",
        "(() => { const views = { recent() { return fetch('https://api.example.test/views'); } }; window.views = views; })();",
        'var Cart = (function () {',
        "  function add(item) { return fetch('https://api.example.test/cart', { method: 'POST', body: JSON.stringify(item) }); }",
        "  return { add: add, clear() { return fetch('https://api.example.test/cart', { method: 'DELETE' }); } };",
        '})();',
      ].join('\n'),
      '/js/page.js': 'function start() {\n  api.load();\n  window.views.recent();\n  const store = new Store();\n  store.save({});\n  Cart.add({});\n  Cart.clear();\n}\n',
    });
    const { found, calls } = drawn(graph);
    expect(found).toEqual([
      'Cart.clear DELETE /cart',
      'Store.save POST /items',
      'add POST /cart',
      'api.load GET /items',
      'init GET /init',
      'init@9 GET /other',
      'views.recent GET /views',
    ]);
    expect(calls).toEqual(['start -> Cart.clear', 'start -> Store.save', 'start -> add', 'start -> api.load', 'start -> views.recent']);
  });

  it("reads what a module's exports and the page are given as members, and joins require and the page's names to them (P311)", () => {
    const graph = read({
      '/js/api.js': [
        "exports.load = function () { return fetch('https://api.example.test/items'); };",
        "module.exports.save = function (item) { return fetch('https://api.example.test/items', { method: 'POST', body: JSON.stringify(item) }); };",
      ].join('\n'),
      '/js/lib.js': [
        "function list() { return fetch('https://api.example.test/list'); }",
        "module.exports = { remove(id) { return fetch(`https://api.example.test/items/${id}`, { method: 'DELETE' }); }, list };",
      ].join('\n'),
      '/js/globals.js': [
        "window.shop = { items() { return fetch('https://api.example.test/shop'); } };",
        "window.ping = function () { return fetch('https://api.example.test/ping'); };",
        "globalThis.stats = { load: () => fetch('https://api.example.test/stats') };",
      ].join('\n'),
      '/js/page.js': [
        "const api = require('./api');",
        'function start() {',
        '  api.load();',
        '  api.save({});',
        "  require('./lib').remove(1);",
        "  require('./lib').list();",
        '  shop.items();',
        '  ping();',
        '  window.stats.load();',
        '}',
      ].join('\n'),
    });
    const { found, calls } = drawn(graph);
    expect(found).toEqual([
      'list GET /list',
      'module.load GET /items',
      'module.remove DELETE /items/:param',
      'module.save POST /items',
      'ping GET /ping',
      'shop.items GET /shop',
      'stats.load GET /stats',
    ]);
    expect(calls).toEqual([
      'start -> list',
      'start -> module.load',
      'start -> module.remove',
      'start -> module.save',
      'start -> ping',
      'start -> shop.items',
      'start -> stats.load',
    ]);
  });

  it("reads a getter and a setter as functions run where the property is read or written, an object's and a class's (P311)", () => {
    const graph = read({
      '/js/api.js': [
        'const api = {',
        "  get items() { return fetch('https://api.example.test/items'); },",
        "  set filter(value) { fetch('https://api.example.test/filter', { method: 'PUT', body: JSON.stringify(value) }); },",
        '};',
        "class Store { get orders() { return fetch('https://api.example.test/orders'); } }",
        "window.shop = { get stock() { return fetch('https://api.example.test/stock'); } };",
      ].join('\n'),
      '/js/page.js': "function start() {\n  const list = api.items;\n  api.filter = 'new';\n  const store = new Store();\n  const stock = shop.stock;\n  return [list, stock, store.orders];\n}\n",
    });
    const { found, calls } = drawn(graph);
    expect(found).toEqual(['Store.orders GET /orders', 'api.filter= PUT /filter', 'api.items GET /items', 'shop.stock GET /stock']);
    expect(calls).toEqual(['start -> Store.orders', 'start -> api.filter=', 'start -> api.items', 'start -> shop.stock']);
  });

  it('reads jQuery, superagent, ky and a fetch ponyfill as the installed client where a page loads them, as axios is (P311)', () => {
    const urls = (graph: RepoGraph): string[] => requests(graph).map((node) => `${node.meta?.['method']} ${node.meta?.['url']}`).sort();
    const jquery = [
      "function load() { return $.ajax({ url: 'https://api.example.test/items', type: 'POST', data: { item: 1 } }); }",
      "function more() { return $.get('https://api.example.test/more'); }",
      "function save() { return jQuery.post('https://api.example.test/save', { item: 2 }); }",
      "function json() { return $.getJSON('https://api.example.test/json'); }",
      "function put() { return $.ajax('https://api.example.test/put', { method: 'PUT' }); }",
      "(function ($) { window.wrapped = function () { return $.ajax({ url: 'https://api.example.test/wrapped' }); }; })(jQuery);",
    ].join('\n');
    const all = [
      'GET https://api.example.test/json',
      'GET https://api.example.test/more',
      'GET https://api.example.test/wrapped',
      'POST https://api.example.test/items',
      'POST https://api.example.test/save',
      'PUT https://api.example.test/put',
    ];
    expect(urls(read({ '/js/shop.js': jquery }, { '/index.html': '<script src="https://code.example.test/jquery-3.7.1.min.js"></script>' }))).toEqual(all);
    expect(urls(read({ '/js/shop.js': `/* global $, jQuery */\n${jquery}` }))).toEqual(all);
    // A slim build leaves the requests out; nothing loaded, nothing read.
    expect(urls(read({ '/js/shop.js': jquery }, { '/index.html': '<script src="https://code.example.test/jquery-3.7.1.slim.min.js"></script>' }))).toEqual([]);
    expect(urls(read({ '/js/shop.js': jquery }))).toEqual([]);
    // The body is what the settings or `.send` hand over.
    const posted = read({ '/js/shop.js': jquery }, { '/index.html': '<script src="vendor/jquery.min.js"></script>' });
    expect(requests(posted).find((node) => node.meta?.['path'] === '/items')?.meta?.['bodyKeys']).toEqual(['item']);
    const agent = "function order() { return superagent.post('https://api.example.test/orders').set('Accept', 'application/json').send({ id: 1 }); }\nfunction gone() { return superagent.del('https://api.example.test/orders/1'); }\n";
    const sent = read({ '/js/order.js': agent }, { '/index.html': '<script src="https://cdn.example.test/npm/superagent@8.1.2/dist/superagent.min.js"></script>' });
    expect(urls(sent)).toEqual(['DELETE https://api.example.test/orders/1', 'POST https://api.example.test/orders']);
    expect(requests(sent).find((node) => node.meta?.['method'] === 'POST')?.meta?.['bodyKeys']).toEqual(['id']);
    const kyScript = "function items() { return ky.get('https://api.example.test/items'); }\n";
    expect(urls(read({ '/js/items.js': kyScript }, { '/index.html': '<script src="https://cdn.example.test/npm/ky@0.33.3/umd.js"></script>' }))).toEqual(['GET https://api.example.test/items']);
    expect(urls(read({ '/js/items.js': kyScript }))).toEqual([]);
    const ponyfill = "function items() { return unfetch('https://api.example.test/items', { method: 'POST' }); }\n";
    expect(urls(read({ '/js/items.js': ponyfill }, { '/index.html': '<script src="https://cdn.example.test/npm/unfetch@4.2.0/dist/unfetch.umd.js"></script>' }))).toEqual(['POST https://api.example.test/items']);
    expect(urls(read({ '/js/items.js': ponyfill }))).toEqual([]);
    // A polyfill installs `fetch` itself, which is read wherever nothing declares it.
    const polyfilled = "function items() { return fetch('https://api.example.test/items'); }\n";
    expect(urls(read({ '/js/items.js': polyfilled }, { '/index.html': '<script src="vendor/whatwg-fetch/fetch.umd.js"></script>' }))).toEqual(['GET https://api.example.test/items']);
  });

  it("counts the globals the linter's configuration declares as the script's own comment (P311)", () => {
    const script = "function items() { return axios.get('https://api.example.test/items'); }\n";
    const urls = (graph: RepoGraph): unknown[] => requests(graph).map((node) => node.meta?.['url']);
    const items = ['https://api.example.test/items'];
    expect(urls(read({ '/js/shop.js': script }, { '/.eslintrc.json': '{ "env": { "browser": true }, "globals": { "axios": "readonly" } }' }))).toEqual(items);
    expect(urls(read({ '/js/shop.js': script }, { '/js/.eslintrc': '// the scripts\n{ globals: { axios: false } }' }))).toEqual(items);
    expect(urls(read({ '/js/shop.js': script }, { '/.eslintrc.yml': 'root: true\nglobals:\n  axios: readonly\n' }))).toEqual(items);
    expect(urls(read({ '/js/shop.js': script }, { '/package.json': '{ "name": "shop", "eslintConfig": { "globals": { "axios": "writable" } } }' }))).toEqual(items);
    const flat = "import globals from 'globals';\nexport default [{ files: ['js/**'], languageOptions: { globals: { ...globals.browser, axios: 'readonly' } } }];\n";
    expect(urls(read({ '/js/shop.js': script }, { '/eslint.config.js': flat }))).toEqual(items);
    // An environment declares its globals: jQuery's `$`.
    const jquery = "function items() { return $.get('https://api.example.test/items'); }\n";
    expect(urls(read({ '/js/shop.js': jquery }, { '/.eslintrc.yaml': 'env:\n  browser: true\n  jquery: true\n' }))).toEqual(items);
    expect(urls(read({ '/js/shop.js': jquery }, { '/eslint.config.mjs': 'export default [{ languageOptions: { globals: { ...globals.jquery } } }];\n' }))).toEqual(items);
    // Turned off, in another directory than the script's, or a manifest's other keys: no declaration.
    expect(urls(read({ '/js/shop.js': script }, { '/.eslintrc.json': '{ "globals": { "axios": "off" } }' }))).toEqual([]);
    expect(urls(read({ '/js/shop.js': script }, { '/tools/.eslintrc.json': '{ "globals": { "axios": "readonly" } }' }))).toEqual([]);
    expect(urls(read({ '/js/shop.js': script }, { '/package.json': '{ "jest": { "globals": { "axios": true } } }' }))).toEqual([]);
  });

  it('reads a wrapper the page runs once it has loaded as a function of its own, and its functions and members as a wrapper run at once keeps them (P317)', () => {
    const graph = read({
      '/js/page.js': [
        '/* global $, jQuery */',
        "document.addEventListener('DOMContentLoaded', function () {",
        "  fetch('https://api.example.test/items');",
        "  function refresh() { return fetch('https://api.example.test/refresh'); }",
        "  const panel = { open() { return fetch('https://api.example.test/panel'); } };",
        '  refresh();',
        '  panel.open();',
        '});',
        "window.addEventListener('load', () => { fetch('https://api.example.test/load'); });",
        "$(function () { fetch('https://api.example.test/ready'); });",
        "$(document).ready(function () { fetch('https://api.example.test/ready'); });",
        "jQuery(function ($) { $.getJSON('https://api.example.test/json'); });",
        "window.onload = function () { fetch('https://api.example.test/onload'); };",
        "$(window).on('load', function () { fetch('https://api.example.test/shown'); });",
        // Not run once the page has loaded: a click, and a `$` the script declares - both written at the top of the script, so drawn from it (P334).
        "document.addEventListener('click', function () { fetch('https://api.example.test/click'); });",
      ].join('\n'),
      '/js/other.js': "export function $(fn) { return fn; }\n$(function () { fetch('https://api.example.test/mine'); });\n",
    });
    const { found, calls } = drawn(graph);
    expect(found).toEqual([
      'onDOMContentLoaded GET /items',
      'onload GET /load',
      'onload@13 GET /onload',
      'onload@14 GET /shown',
      'onready GET /ready',
      'onready@11 GET /ready',
      'onready@12 GET /json',
      'other.js:top GET /mine',
      'page.js:top GET /click',
      'panel.open GET /panel',
      'refresh GET /refresh',
    ]);
    expect(calls).toEqual(['onDOMContentLoaded -> panel.open', 'onDOMContentLoaded -> refresh', 'other.js:top -> $']);
  });

  it('reads a client a CommonJS script requires as the client it imports (P317)', () => {
    const urls = (graph: RepoGraph): string[] => requests(graph).map((node) => `${node.meta?.['client']} ${node.meta?.['method']} ${node.meta?.['url']}`).sort();
    const graph = read({
      '/js/api.js': [
        "const axios = require('axios');",
        "const $ = require('jquery');",
        "const request = require('superagent');",
        "const ky = require('ky').default;",
        "const { get } = require('axios');",
        "function items() { return axios.get('https://api.example.test/items'); }",
        "function more() { return $.get('https://api.example.test/more'); }",
        "function place(order) { return request.post('https://api.example.test/orders').send(order); }",
        "function stock() { return ky.get('https://api.example.test/stock'); }",
        // A member taken out of the module is not the module.
        "function other() { return get.call(null, 'https://api.example.test/other'); }",
      ].join('\n'),
    });
    expect(urls(graph)).toEqual([
      'axios GET https://api.example.test/items',
      'jquery GET https://api.example.test/more',
      'ky GET https://api.example.test/stock',
      'superagent POST https://api.example.test/orders',
    ]);
  });

  it("reads superagent called as a function and its query, and jQuery's data on a GET as the query (P317)", () => {
    const read1 = (script: string): GraphNode[] => requests(read({ '/js/api.js': `/* global $, superagent */\n${script}` }));
    const row = (node: GraphNode): unknown[] => [node.meta?.['method'], node.meta?.['path'], node.meta?.['bodyKeys'], node.meta?.['queryKeys']];
    const found = read1(
      [
        "function a() { return superagent('GET', 'https://api.example.test/a').query({ page: 1 }); }",
        "function b() { return superagent('post', 'https://api.example.test/b').set('Accept', 'json').send({ id: 1 }); }",
        "function c() { return superagent('https://api.example.test/c'); }",
        "function d() { return superagent.get('https://api.example.test/d').query({ q: 'x', page: 2 }); }",
        "function e() { return $.get('https://api.example.test/e', { page: 1 }); }",
        "function f() { return $.get('https://api.example.test/f', function (items) { return items; }); }",
        "function g() { return $.ajax({ url: 'https://api.example.test/g', type: 'GET', data: { page: 1 } }); }",
        "function h() { return $.getJSON('https://api.example.test/h', { page: 1 }); }",
        "function i() { return $.ajax({ url: 'https://api.example.test/i', type: 'POST', data: { item: 1 } }); }",
        "function j() { return $.ajax('https://api.example.test/j', { data: { page: 1 } }); }",
      ].join('\n'),
    );
    expect(found.map(row).sort((x, y) => String(x[1]).localeCompare(String(y[1])))).toEqual([
      ['GET', '/a', undefined, ['page']],
      ['POST', '/b', ['id'], undefined],
      ['GET', '/c', undefined, undefined],
      ['GET', '/d', undefined, ['page', 'q']],
      ['GET', '/e', undefined, ['page']],
      ['GET', '/f', undefined, undefined],
      ['GET', '/g', undefined, ['page']],
      ['GET', '/h', undefined, ['page']],
      ['POST', '/i', ['item'], undefined],
      ['GET', '/j', undefined, ['page']],
    ]);
    expect(found.find((node) => node.meta?.['path'] === '/e')?.meta?.['bodyType']).toBeNull();
  });

  it("counts a linter's globals only where its configuration reaches the script: root stops the walk, overrides and a flat configuration's files name the scripts (P317)", () => {
    const script = "function items() { return axios.get('https://api.example.test/items'); }\n";
    const urls = (files: Record<string, string>, pages: Record<string, string>): unknown[] => requests(read(files, pages)).map((node) => node.meta?.['url']);
    const items = ['https://api.example.test/items'];
    const declares = '{ "globals": { "axios": "readonly" } }';
    // `root: true` below stops the walk before the one above.
    expect(urls({ '/web/js/shop.js': script }, { '/.eslintrc.json': declares, '/web/.eslintrc.json': '{ "root": true }' })).toEqual([]);
    expect(urls({ '/web/js/shop.js': script }, { '/.eslintrc.json': declares, '/web/.eslintrc.json': '{ "env": { "browser": true } }' })).toEqual(items);
    expect(urls({ '/web/js/shop.js': script }, { '/.eslintrc.json': declares, '/web/.eslintrc.yml': 'root: true\n' })).toEqual([]);
    // An override's globals count for the files it names: a name alone anywhere below, a path from the configuration's directory.
    const override = (files: string, excluded = '[]'): string => `{ "overrides": [{ "files": ${files}, "excludedFiles": ${excluded}, "globals": { "axios": "readonly" } }] }`;
    expect(urls({ '/js/shop.js': script }, { '/.eslintrc.json': override('["*.js"]') })).toEqual(items);
    expect(urls({ '/js/shop.js': script }, { '/.eslintrc.json': override('["js/**/*.{js,mjs}"]') })).toEqual(items);
    expect(urls({ '/js/shop.js': script }, { '/.eslintrc.json': override('["test/**"]') })).toEqual([]);
    expect(urls({ '/js/shop.js': script }, { '/.eslintrc.json': override('["*.js"]', '["shop.js"]') })).toEqual([]);
    expect(urls({ '/js/shop.js': script }, { '/.eslintrc.yaml': 'overrides:\n  - files: ["js/*.js"]\n    globals:\n      axios: readonly\n' })).toEqual(items);
    expect(urls({ '/js/shop.js': script }, { '/.eslintrc.yaml': 'overrides:\n  - files:\n      - "test/*.js"\n    globals:\n      axios: readonly\n' })).toEqual([]);
    // A flat configuration's object with `files` names the scripts from its own directory, `ignores` taking some out; and none above it is read.
    const flat = (files: string, ignores = '[]'): string => `export default [{ files: ${files}, ignores: ${ignores}, languageOptions: { globals: { axios: 'readonly' } } }];\n`;
    expect(urls({ '/js/shop.js': script }, { '/eslint.config.js': flat("['js/**/*.js']") })).toEqual(items);
    expect(urls({ '/js/shop.js': script }, { '/eslint.config.js': flat("['*.js']") })).toEqual([]);
    expect(urls({ '/js/shop.js': script }, { '/eslint.config.js': flat("['**/*.js']", "['js/shop.js']") })).toEqual([]);
    expect(urls({ '/js/shop.js': script }, { '/.eslintrc.json': declares, '/js/eslint.config.mjs': 'export default [];\n' })).toEqual([]);
    // Of two cascading configurations in one directory, the linter takes the first.
    expect(urls({ '/js/shop.js': script }, { '/.eslintrc.js': 'module.exports = {};\n', '/.eslintrc.json': declares })).toEqual([]);
  });

  it('reads a wrapper run at once as a function of its own, a request at its top drawn from it, and the functions it keeps left to themselves (P323)', () => {
    const graph = read({
      '/js/shop.js': [
        '(function () {',
        "  fetch('https://api.example.test/boot');",
        "  function init() { return fetch('https://api.example.test/init'); }",
        '  init();',
        "  document.getElementById('buy').addEventListener('click', function () { fetch('https://api.example.test/buy', { method: 'POST' }); });",
        "  document.addEventListener('DOMContentLoaded', function () { fetch('https://api.example.test/ready'); });",
        '})();',
        "var shop = (function () { fetch('https://api.example.test/kept'); return {}; })();",
        "(function boot() { fetch('https://api.example.test/named'); })();",
        "!function () { fetch('https://api.example.test/other'); }();",
      ].join('\n'),
    });
    const { found, calls } = drawn(graph);
    expect(found).toEqual([
      'boot GET /named',
      'init GET /init',
      'onDOMContentLoaded GET /ready',
      'shop GET /kept',
      'wrapper GET /boot',
      'wrapper POST /buy',
      'wrapper@10 GET /other',
    ]);
    expect(calls).toEqual(['wrapper -> init']);
  });

  it("reads the page's other load events as handlers it runs once it has loaded (P323)", () => {
    const graph = read({
      '/js/page.js': [
        '/* global $ */',
        "window.addEventListener('pageshow', function () { fetch('https://api.example.test/shown'); });",
        "document.addEventListener('readystatechange', () => { fetch('https://api.example.test/state'); });",
        "document.onreadystatechange = function () { fetch('https://api.example.test/assigned'); };",
        "window.onpageshow = function () { fetch('https://api.example.test/back'); };",
        "$(window).load(function () { fetch('https://api.example.test/old'); });",
        "$(window).bind('load', function () { fetch('https://api.example.test/bound'); });",
        // jQuery's `.load(url)` on an element is a request of its own, no handler: drawn from the top of the script it is written at (P334), as a resize handler is.
        "$('#box').load(function () { fetch('https://api.example.test/box'); });",
        "window.addEventListener('resize', function () { fetch('https://api.example.test/resize'); });",
      ].join('\n'),
    });
    expect(drawn(graph).found).toEqual([
      'onload GET /old',
      'onload@7 GET /bound',
      'onpageshow GET /shown',
      'onpageshow@5 GET /back',
      'onreadystatechange GET /state',
      'onreadystatechange@4 GET /assigned',
      'page.js:top GET /box',
      'page.js:top GET /resize',
    ]);
  });

  it("reads what superagent's .send hands a GET or a HEAD as its query, beside .query's (P323)", () => {
    const found = requests(
      read({
        '/js/api.js': [
          '/* global superagent */',
          "function a() { return superagent.get('https://api.example.test/a').send({ page: 1 }); }",
          "function b() { return superagent.get('https://api.example.test/b').query({ q: 'x' }).send({ page: 1 }); }",
          "function c() { return superagent('HEAD', 'https://api.example.test/c').send({ page: 1 }); }",
          "function d() { return superagent('https://api.example.test/d').send({ page: 1 }); }",
          "function e() { return superagent.post('https://api.example.test/e').send({ item: 1 }); }",
        ].join('\n'),
      }),
    );
    const row = (node: GraphNode): unknown[] => [node.meta?.['method'], node.meta?.['path'], node.meta?.['bodyKeys'], node.meta?.['queryKeys']];
    expect(found.map(row).sort((x, y) => String(x[1]).localeCompare(String(y[1])))).toEqual([
      ['GET', '/a', undefined, ['page']],
      ['GET', '/b', undefined, ['page', 'q']],
      ['HEAD', '/c', undefined, ['page']],
      ['GET', '/d', undefined, ['page']],
      ['POST', '/e', ['item'], undefined],
    ]);
  });

  it("counts the globals a configuration's extends and a flat configuration's modules declare, and none for a file a flat configuration ignores (P323)", () => {
    const script = "function items() { return axios.get('https://api.example.test/items'); }\n";
    const urls = (pages: Record<string, string>, files: Record<string, string> = { '/js/shop.js': script }): unknown[] => requests(read(files, pages)).map((node) => node.meta?.['url']);
    const items = ['https://api.example.test/items'];
    const declares = '{ "globals": { "axios": "readonly" } }';
    // A cascading `extends`: a file by its path, a shareable configuration by its short name, scoped or not, and one extending another.
    expect(urls({ '/.eslintrc.json': '{ "extends": "./config/base.json" }', '/config/base.json': declares })).toEqual(items);
    expect(urls({ '/.eslintrc.json': '{ "extends": ["eslint:recommended", "shop"] }', '/node_modules/eslint-config-shop/package.json': '{ "main": "lib/index.js" }', '/node_modules/eslint-config-shop/lib/index.js': 'module.exports = { globals: { axios: "readonly" } };\n' })).toEqual(items);
    expect(urls({ '/.eslintrc.yml': 'extends:\n  - "@acme/web"\n', '/node_modules/@acme/eslint-config-web/index.js': 'module.exports = { extends: ["./browser"] };\n', '/node_modules/@acme/eslint-config-web/browser.js': `module.exports = ${declares};\n` })).toEqual(items);
    expect(urls({ '/.eslintrc.json': '{ "overrides": [{ "files": ["test/**"], "extends": "./config/base.json" }] }', '/config/base.json': declares })).toEqual([]);
    expect(urls({ '/.eslintrc.json': '{ "extends": ["plugin:shop/recommended", "missing"] }' })).toEqual([]);
    // A flat configuration's modules: spread, an element, a helper's argument, required; under the `files` they are named in.
    const base = "export default [{ languageOptions: { globals: { axios: 'readonly' } } }];\n";
    expect(urls({ '/eslint.config.js': "import base from './config/base.js';\nexport default [...base, { rules: {} }];\n", '/config/base.js': base })).toEqual(items);
    expect(urls({ '/eslint.config.mjs': "import shared from 'shop-lint';\nexport default [shared];\n", '/node_modules/shop-lint/package.json': '{ "exports": { ".": { "import": "./flat.mjs" } } }', '/node_modules/shop-lint/flat.mjs': base })).toEqual(items);
    expect(urls({ '/eslint.config.js': "import tseslint from 'typescript-eslint';\nimport base from './config/base';\nexport default tseslint.config(base);\n", '/config/base.js': base })).toEqual(items);
    expect(urls({ '/eslint.config.cjs': "const base = require('./config/base.js');\nmodule.exports = [{ files: ['js/**'], ...base }];\n", '/config/base.js': "module.exports = { languageOptions: { globals: { axios: 'readonly' } } };\n" })).toEqual(items);
    expect(urls({ '/eslint.config.cjs': "module.exports = [{ files: ['test/**'], ...require('./config/base.js') }];\n", '/config/base.js': "module.exports = { languageOptions: { globals: { axios: 'readonly' } } };\n" })).toEqual([]);
    // An object writing `ignores` alone ignores those files for every object; beside other keys, only for its own.
    const flat = (ignored: string): string => `export default [{ ignores: ${ignored} }, { languageOptions: { globals: { axios: 'readonly' } } }];\n`;
    expect(urls({ '/eslint.config.js': flat("['vendor/**']") })).toEqual(items);
    expect(urls({ '/eslint.config.js': flat("['js/']") })).toEqual([]);
    expect(urls({ '/eslint.config.js': flat("['js/shop.js']") })).toEqual([]);
    expect(urls({ '/eslint.config.js': "export default [{ name: 'ignored', ignores: ['js/**'] }, { languageOptions: { globals: { axios: 'readonly' } } }];\n" })).toEqual([]);
    expect(urls({ '/eslint.config.js': "export default [{ ignores: ['vendor/**'], languageOptions: { globals: { axios: 'readonly' } } }];\n" })).toEqual(items);
    expect(urls({ '/eslint.config.js': "export default [{ ignores: ['js/**'], languageOptions: { globals: { axios: 'readonly' } } }];\n" })).toEqual([]);
  });

  it("says a client's global called with nothing declaring it, rather than nothing (P323)", () => {
    const graph = read({
      '/js/api.js': [
        "function a() { return ky.post('https://api.example.test/a'); }",
        "function b() { return axios.get('https://api.example.test/b'); }",
        "(function ($) { $.ajax({ url: 'https://api.example.test/c' }); })(jQuery);",
        // Not a request's spelling, a name the repository declares, or a parameter handed nothing.
        "function d() { return $('#box'); }",
        'function e(superagent) { return superagent.get("https://api.example.test/e"); }',
      ].join('\n'),
      '/js/own.js': "export const axios = { get: function () {} };\nexport function f() { return axios.get('https://api.example.test/f'); }\n",
    });
    expect(requests(graph)).toEqual([]);
    const rows = graph.unresolved.filter((row) => row.reason === 'api-client-global-undeclared');
    expect(rows.map((row) => [row.line, row.meta?.['client'], row.meta?.['global']])).toEqual([
      [1, 'ky', 'ky'],
      [2, 'axios', 'axios'],
      [3, 'jquery', 'jQuery'],
    ]);
    expect(rows[0]?.hint).toContain('/* global ky */');
  });

  it("reads a plugin's configuration an extends names, a flat object's extends by text, and the one export a configuration imports (P334)", () => {
    const script = "function items() { return axios.get('https://api.example.test/items'); }\n";
    const urls = (pages: Record<string, string>): unknown[] => requests(read({ '/js/shop.js': script }, pages)).map((node) => node.meta?.['url']);
    const items = ['https://api.example.test/items'];
    const legacyPlugin = "module.exports = { configs: { browser: { globals: { axios: 'readonly' } }, node: { env: { node: true } } } };\n";
    // `plugin:x/y` in a cascading `extends`: the plugin's `configs.y`, by its package's spelled-out name.
    expect(urls({ '/.eslintrc.json': '{ "extends": ["plugin:shop/browser"] }', '/node_modules/eslint-plugin-shop/index.js': legacyPlugin })).toEqual(items);
    expect(urls({ '/.eslintrc.json': '{ "extends": ["plugin:shop/node"] }', '/node_modules/eslint-plugin-shop/index.js': legacyPlugin })).toEqual([]);
    expect(
      urls({
        '/.eslintrc.yml': 'extends:\n  - plugin:@acme/browser\n',
        '/node_modules/@acme/eslint-plugin/package.json': '{ "main": "lib/plugin.js" }',
        '/node_modules/@acme/eslint-plugin/lib/plugin.js': "const browser = require('./configs/browser');\nmodule.exports = { configs: { browser } };\n",
        '/node_modules/@acme/eslint-plugin/lib/configs/browser.js': "module.exports = { globals: { axios: 'readonly' } };\n",
      }),
    ).toEqual(items);
    // A flat object's `extends` by text: the plugin its `plugins` hands under the namespace, else the plugin's package.
    const flatPlugin = "const plugin = { configs: {} };\nplugin.configs = { browser: { languageOptions: { globals: { axios: 'readonly' } } } };\nexport default plugin;\n";
    expect(urls({ '/eslint.config.js': "import shop from './lint/plugin.js';\nexport default [{ plugins: { shop }, extends: ['shop/browser'] }];\n", '/lint/plugin.js': flatPlugin })).toEqual(items);
    expect(urls({ '/eslint.config.js': "export default [{ extends: ['shop/browser'] }];\n", '/node_modules/eslint-plugin-shop/index.js': flatPlugin })).toEqual(items);
    expect(urls({ '/eslint.config.js': "export default [{ files: ['test/**'], extends: ['shop/browser'] }];\n", '/node_modules/eslint-plugin-shop/index.js': flatPlugin })).toEqual([]);
    // A plugin handed over and no configuration of it named: none of its configurations read.
    expect(urls({ '/eslint.config.js': "import shop from './lint/plugin.js';\nexport default [{ plugins: { shop } }];\n", '/lint/plugin.js': flatPlugin })).toEqual([]);
    // A named import reads that export alone; the module's others declare nothing for it.
    const shared = "export const base = { languageOptions: { globals: { axios: 'readonly' } } };\nexport const node = { languageOptions: { globals: { process: 'readonly' } } };\n";
    expect(urls({ '/eslint.config.js': "import { base } from './lint/shared.js';\nexport default [base];\n", '/lint/shared.js': shared })).toEqual(items);
    expect(urls({ '/eslint.config.js': "import { node } from './lint/shared.js';\nexport default [node];\n", '/lint/shared.js': shared })).toEqual([]);
    expect(urls({ '/eslint.config.js': "import { node as base } from './lint/shared.js';\nexport default [base];\n", '/lint/shared.js': shared })).toEqual([]);
    const common = "module.exports = { base: { languageOptions: { globals: { axios: 'readonly' } } }, node: {} };\n";
    expect(urls({ '/eslint.config.cjs': "const { base } = require('./lint/shared.cjs');\nmodule.exports = [base];\n", '/lint/shared.cjs': common })).toEqual(items);
    expect(urls({ '/eslint.config.cjs': "const { node } = require('./lint/shared.cjs');\nmodule.exports = [node];\n", '/lint/shared.cjs': common })).toEqual([]);
    expect(urls({ '/eslint.config.cjs': "module.exports = [require('./lint/shared.cjs').base];\n", '/lint/shared.cjs': common })).toEqual(items);
    // Re-exported from another module, and kept under a local name.
    expect(
      urls({
        '/eslint.config.js': "import { base } from './lint/index.js';\nexport default [base];\n",
        '/lint/index.js': "export { base } from './shared.js';\n",
        '/lint/shared.js': "const browser = { languageOptions: { globals: { axios: 'readonly' } } };\nexport { browser as base };\n",
      }),
    ).toEqual(items);
  });

  it("looks for what a linter's configuration names inside the repository alone, never above its root (P334)", () => {
    const script = "function items() { return axios.get('https://api.example.test/items'); }\n";
    const urls = (pages: Record<string, string>): unknown[] => requests(read({ '/repo/js/shop.js': script }, pages, '/repo')).map((node) => node.meta?.['url']);
    const items = ['https://api.example.test/items'];
    const declares = "module.exports = { globals: { axios: 'readonly' } };\n";
    expect(urls({ '/repo/.eslintrc.json': '{ "extends": "shop" }', '/repo/node_modules/eslint-config-shop/index.js': declares })).toEqual(items);
    // Installed above the repository's root, where Node would look next: not read.
    expect(urls({ '/repo/.eslintrc.json': '{ "extends": "shop" }', '/node_modules/eslint-config-shop/index.js': declares })).toEqual([]);
    expect(urls({ '/repo/.eslintrc.json': '{ "extends": "plugin:shop/browser" }', '/node_modules/eslint-plugin-shop/index.js': "module.exports = { configs: { browser: { globals: { axios: 'readonly' } } } };\n" })).toEqual([]);
    expect(urls({ '/repo/eslint.config.js': "import shared from 'shop-lint';\nexport default [shared];\n", '/node_modules/shop-lint/index.js': "export default [{ languageOptions: { globals: { axios: 'readonly' } } }];\n" })).toEqual([]);
    // A path leading out of it, relative or absolute: not read.
    expect(urls({ '/repo/.eslintrc.json': '{ "extends": "../outside.json" }', '/outside.json': '{ "globals": { "axios": "readonly" } }' })).toEqual([]);
    expect(urls({ '/repo/.eslintrc.json': '{ "extends": "/outside.json" }', '/outside.json': '{ "globals": { "axios": "readonly" } }' })).toEqual([]);
    expect(urls({ '/repo/eslint.config.js': "import base from '../outside.js';\nexport default [base];\n", '/outside.js': "export default { languageOptions: { globals: { axios: 'readonly' } } };\n" })).toEqual([]);
  });

  it('reads the top of a script as a function of its own where it writes a call outside every function it keeps (P334)', () => {
    const graph = read({
      '/js/boot.js': [
        '/* global superagent */',
        "superagent.get('https://api.example.test/top');",
        'init();',
        "document.querySelector('#buy').addEventListener('click', function () { fetch('https://api.example.test/buy', { method: 'POST' }); });",
        "function init() { return fetch('https://api.example.test/init'); }",
        "class Cart { load() { return fetch('https://api.example.test/cart'); } }",
      ].join('\n'),
      // Functions, a wrapper run at once and a handler the page runs once it has loaded: no top of its own.
      '/js/quiet.js': [
        "function later() { return fetch('https://api.example.test/later'); }",
        "(function () { fetch('https://api.example.test/wrapped'); })();",
        "document.addEventListener('DOMContentLoaded', function () { fetch('https://api.example.test/ready'); });",
      ].join('\n'),
    });
    const { found, calls } = drawn(graph);
    expect(found).toEqual([
      'Cart.load GET /cart',
      'boot.js:top GET /top',
      'boot.js:top POST /buy',
      'init GET /init',
      'later GET /later',
      'onDOMContentLoaded GET /ready',
      'wrapper GET /wrapped',
    ]);
    expect(calls).toEqual(['boot.js:top -> init']);
    expect(graph.nodes.filter((node) => node.label === 'quiet.js:top')).toEqual([]);
  });

  it("asks a client's global called directly, or a wrapper's parameter called as one, for a declaration as its members are (P334)", () => {
    const graph = read({
      '/js/bare.js': [
        "function a() { return ky('https://api.example.test/a'); }",
        "(function (request) { request('https://api.example.test/b'); })(superagent);",
        "(function (get) { get('https://api.example.test/c'); })(unfetch);",
        // A parameter handed nothing a client's browser build leaves, and a call with no argument: nothing said.
        "(function (load) { load('https://api.example.test/d'); })(loader);",
        'function e() { return ky(); }',
      ].join('\n'),
      '/js/declared.js': "/* global ky, superagent */\nfunction f() { return ky('https://api.example.test/f'); }\n(function (request) { request('https://api.example.test/g'); })(superagent);\n",
    });
    expect(requests(graph).map((node) => node.meta?.['url']).sort()).toEqual(['https://api.example.test/f', 'https://api.example.test/g']);
    const rows = graph.unresolved.filter((row) => row.reason === 'api-client-global-undeclared');
    expect(rows.map((row) => [row.file, row.line, row.meta?.['client'], row.meta?.['global']])).toEqual([
      ['js/bare.js', 1, 'ky', 'ky'],
      ['js/bare.js', 2, 'superagent', 'superagent'],
      ['js/bare.js', 3, 'unfetch', 'unfetch'],
    ]);
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
