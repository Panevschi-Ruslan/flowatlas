import { GraphBuilder } from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { REQUEST_CLIENTS, requestFactsPass } from './request-clients.js';

const FIXED = '2026-01-01T00:00:00.000Z';

/**
 * A service's two requests at fixed places, marked as the reader of `mark`'s
 * client marks them, read by the pass every reader runs (P394).
 */
const read = (mark: Record<string, string>, service: string) => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
  project.createSourceFile('/web/src/orders.service.ts', service);
  const builder = new GraphBuilder({ repo: 'web', generatedAt: FIXED });
  const request = (line: number, column: number, method: string) =>
    builder.addNode({ id: `ui_api_call:web#src/orders.service.ts:${line}:${column}`, type: 'ui_api_call', label: `${method} /orders`, repo: 'web', meta: { method, ...mark } });
  builder.addNode({ id: 'm:list', type: 'method', label: 'OrdersService.list', repo: 'web', file: 'src/orders.service.ts', line: 2 });
  builder.addNode({ id: 'm:cancel', type: 'method', label: 'OrdersService.cancel', repo: 'web', file: 'src/orders.service.ts', line: 3 });
  const list = request(2, 18, 'GET');
  const cancel = request(3, 31, 'POST');
  builder.addEdge({ from: 'm:list', to: list.id, type: 'calls', confidence: 'static' });
  builder.addEdge({ from: 'm:cancel', to: cancel.id, type: 'calls', confidence: 'static' });
  requestFactsPass.run({ repo: 'web', repoDir: '/web', project, builder });
  return { list: builder.getNode(list.id)?.meta, cancel: builder.getNode(cancel.id)?.meta };
};

describe('the HTTP clients the request facts know (P394)', () => {
  it('describes each client once, by the mark its reader writes', () => {
    const marks = REQUEST_CLIENTS.map((client) => `${client.drawnWith.key}=${client.drawnWith.value}`);
    expect(new Set(marks).size).toBe(marks.length);
  });

  it("reads Angular's HttpClient: a body before the options, its headers, and an interceptor's clone", () => {
    const service = [
      'export class OrdersService { constructor(private http: any) {}',
      "  list() { return this.http.get('/orders'); }",
      "  cancel(id: string) { return this.http.post('/orders', { id }, { headers: { 'X-Tenant': 't' } }); }",
      '}',
      'export const withCookies = (req: any, next: any) => next(req.clone({ withCredentials: true }));',
    ].join('\n');
    const { list, cancel } = read({ package: '@angular/common/http' }, service);
    expect(list).toMatchObject({ credentials: { at: 'src/orders.service.ts:5', via: 'interceptor' } });
    expect(cancel).toMatchObject({ headers: ['x-tenant'], sendsJson: true });
  });

  it("reads axios's defaults and an instance made with credentials", () => {
    const service = [
      'export class OrdersService { constructor(private http: any) {}',
      "  list() { return this.http.get('/orders'); }",
      "  cancel(id: string) { return this.http.post('/orders', { id }); }",
      '}',
      "declare const axios: any; axios.defaults.headers.common['X-Tenant'] = 't';",
      'export const api = axios.create({ withCredentials: true });',
    ].join('\n');
    const { list, cancel } = read({ client: 'axios' }, service);
    expect(list).toMatchObject({ credentials: { at: 'src/orders.service.ts:6', via: 'instance' }, headers: ['x-tenant'] });
    expect(cancel).toMatchObject({ sendsJson: true });
  });

  it('gives no interceptor of one client to the requests of another', () => {
    const service = [
      'export class OrdersService { constructor(private http: any) {}',
      "  list() { return this.http.get('/orders'); }",
      "  cancel(id: string) { return this.http.post('/orders', { id }); }",
      '}',
      'export const withCookies = (req: any, next: any) => next(req.clone({ withCredentials: true }));',
    ].join('\n');
    const { list, cancel } = read({ client: 'ky' }, service);
    expect(list?.['credentials']).toBeUndefined();
    expect(cancel).toMatchObject({ sendsJson: true });
  });
});
