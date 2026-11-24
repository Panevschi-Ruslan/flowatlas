import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { GraphBuilder } from './builder.js';
import { readRequestFacts, statusComparisonsIn } from './request-facts.js';

const FIXED = '2026-01-01T00:00:00.000Z';

/** One repository at `/web`, its files written in memory. */
const projectOf = (files: Record<string, string>): Project => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
  for (const [path, text] of Object.entries(files)) project.createSourceFile(`/web/${path}`, text);
  return project;
};

const statuses = (text: string): number[] => {
  const project = projectOf({ 'src/a.ts': text });
  return statusComparisonsIn(project.getSourceFileOrThrow('/web/src/a.ts')).map((each) => each.status);
};

/** What a request says about itself (P388). */
describe('the statuses code branches on', () => {
  it('reads a status compared as a number or a constant, on an untyped error or an answer', () => {
    expect(
      statuses(`
        enum Code { Conflict = 409 }
        function f(err: any, res: { status: number } & Response) {
          if (err.status === 410) return;
          if (err.response?.status == Code.Conflict) return;
          switch (res.status) { case 422: break; case 200: break; }
        }`),
    ).toEqual([410, 409, 422, 200]);
  });

  it('leaves out an entity of the project with a status of its own, and a number that is no status', () => {
    expect(statuses('interface Order { status: number }\nfunction f(order: Order, e: any) { if (order.status === 409) return; if (e.status === 7) return; }')).toEqual([]);
  });
});

describe('what a browser request says about itself', () => {
  const read = (service: string, panel = '') => {
    const project = projectOf({ 'src/orders.service.ts': service, 'src/panel.ts': panel });
    const builder = new GraphBuilder({ repo: 'web', generatedAt: FIXED });
    const request = (line: number, column: number, method: string) =>
      builder.addNode({ id: `ui_api_call:web#src/orders.service.ts:${line}:${column}`, type: 'ui_api_call', label: `${method} /orders`, repo: 'web', meta: { method, package: '@angular/common/http' } });
    builder.addNode({ id: 'm:list', type: 'method', label: 'OrdersService.list', repo: 'web', file: 'src/orders.service.ts', line: 2 });
    builder.addNode({ id: 'm:cancel', type: 'method', label: 'OrdersService.cancel', repo: 'web', file: 'src/orders.service.ts', line: 3 });
    builder.addNode({ id: 'm:panel', type: 'method', label: 'Panel.cancel', repo: 'web', file: 'src/panel.ts', line: 2 });
    const list = request(2, 18, 'GET');
    const cancel = request(3, 31, 'POST');
    builder.addEdge({ from: 'm:list', to: list.id, type: 'calls', confidence: 'static' });
    builder.addEdge({ from: 'm:cancel', to: cancel.id, type: 'calls', confidence: 'static' });
    builder.addEdge({ from: 'm:panel', to: 'm:cancel', type: 'calls', confidence: 'static' });
    readRequestFacts({ repo: 'web', repoDir: '/web', project, builder });
    return { list: builder.getNode(list.id)?.meta, cancel: builder.getNode(cancel.id)?.meta };
  };

  it('reads credentials, headers, a JSON body, and the statuses the one caller waiting on it branches on', () => {
    const service = [
      'export class OrdersService { constructor(private http: any) {}',
      "  list() { return this.http.get('/orders', { withCredentials: true }); }",
      "  cancel(id: string) { return this.http.post('/orders', { id }, { headers: { 'X-Tenant': 't', Accept: 'a' } }); }",
      '}',
    ].join('\n');
    const panel = ['export class Panel { constructor(private orders: any) {}', '  cancel() { this.orders.cancel(1).subscribe({ error: (e) => { if (e.status === 410) return; } }); }', '}'].join('\n');
    const { list, cancel } = read(service, panel);
    expect(list).toMatchObject({ credentials: { at: 'src/orders.service.ts:2', via: 'call' } });
    expect(cancel).toMatchObject({ headers: ['accept', 'x-tenant'], sendsJson: true, statusChecks: [{ status: 410, at: 'src/panel.ts:2', in: 'Panel.cancel' }] });
  });

  it('takes credentials an interceptor gives every request', () => {
    const service = [
      'export class OrdersService { constructor(private http: any) {}',
      "  list() { return this.http.get('/orders'); }",
      "  cancel(id: string) { return this.http.post('/orders', 'text'); }",
      '}',
      'export const withCookies = (req: any, next: any) => next(req.clone({ withCredentials: true }));',
    ].join('\n');
    const { list, cancel } = read(service);
    expect(list).toMatchObject({ credentials: { at: 'src/orders.service.ts:5', via: 'interceptor' } });
    expect(cancel?.['sendsJson']).toBeUndefined();
  });
});
