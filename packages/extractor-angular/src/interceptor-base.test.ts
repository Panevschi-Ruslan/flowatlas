import {
  GraphBuilder,
  noAdapters,
  parseConfig,
  silentLogger,
  type ExtractContext,
  type GraphNode,
  type RepoGraph,
} from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { extractAngular } from './extract-repo.js';

const CORE = `
export interface InjectableMetadata { providedIn?: string }
export declare function Injectable(metadata?: InjectableMetadata): ClassDecorator;
`;

const RXJS = `export declare class Observable<T> { subscribe(next?: (value: T) => void): void }`;

const HTTP = `
import type { Observable } from 'rxjs';
export declare class HttpClient {
  get<T>(url: string, options?: unknown): Observable<T>;
  post<T>(url: string, body: unknown, options?: unknown): Observable<T>;
}
export declare class HttpRequest<T> { readonly url: string; clone(update: { url?: string }): HttpRequest<T> }
export declare class HttpHandler { handle(req: HttpRequest<unknown>): Observable<unknown> }
export type HttpHandlerFn = (req: HttpRequest<unknown>) => Observable<unknown>;
export type HttpInterceptorFn = (req: HttpRequest<unknown>, next: HttpHandlerFn) => Observable<unknown>;
export interface HttpInterceptor { intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<unknown> }
export declare const HTTP_INTERCEPTORS: unknown;
export declare function provideHttpClient(...features: unknown[]): unknown;
export declare function withInterceptors(interceptors: unknown[]): unknown;
`;

const ENVIRONMENT = `export const environment = { apiUrl: 'https://api.test' };`;

const SERVICE = `
import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class OrdersService {
  constructor(private readonly http: HttpClient) {}
  list() { return this.http.get('/orders'); }
  status() { return this.http.get('https://status.example.test/health'); }
  raw() { return fetch('/plain'); }
}
`;

/** One Angular repository: the service above, beside the interceptors and the registration each test writes. */
const extract = (files: Record<string, string>): RepoGraph => {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('node_modules/@angular/core/index.d.ts', CORE);
  project.createSourceFile('node_modules/@angular/core/package.json', '{"name":"@angular/core"}');
  project.createSourceFile('node_modules/@angular/common/http/index.d.ts', HTTP);
  project.createSourceFile('node_modules/@angular/common/package.json', '{"name":"@angular/common"}');
  project.createSourceFile('node_modules/rxjs/index.d.ts', RXJS);
  project.createSourceFile('node_modules/rxjs/package.json', '{"name":"rxjs"}');
  project.createSourceFile('environment.ts', ENVIRONMENT);
  project.createSourceFile('orders.service.ts', SERVICE);
  for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);
  const builder = new GraphBuilder({ repo: 'web', generatedAt: '2026-01-01T00:00:00.000Z' });
  const base: ExtractContext = {
    repo: 'web',
    repoDir: '/',
    service: { name: 'web', repo: '.', type: 'angular' },
    config: parseConfig({}),
    pkg: {},
    project,
    checker: project.getTypeChecker(),
    builder,
    adapters: noAdapters,
    logger: silentLogger,
  };
  extractAngular(base);
  return builder.build();
};

const requests = (graph: RepoGraph): GraphNode[] => graph.nodes.filter((node) => node.type === 'ui_api_call');
const addresses = (graph: RepoGraph): string[] =>
  requests(graph).map((node) => `${String(node.meta?.['method'])} ${String(node.meta?.['url'])}`).sort();
const rows = (graph: RepoGraph) => graph.unresolved.filter((row) => row.reason === 'api-client-base-unread');

const REGISTERED = `
import { provideHttpClient, withInterceptors, HTTP_INTERCEPTORS } from '@angular/common/http';
export const providers = [provideHttpClient(withInterceptors([apiInterceptor]))];
import { apiInterceptor } from './api.interceptor';
`;

describe("an interceptor's base, in front of every request of the framework's client (P239)", () => {
  it('reads a function interceptor written with +, and leaves an absolute address and fetch alone', () => {
    const graph = extract({
      'api.interceptor.ts': `
        import type { HttpInterceptorFn } from '@angular/common/http';
        import { environment } from './environment';
        export const apiInterceptor: HttpInterceptorFn = (req, next) => next(req.clone({ url: environment.apiUrl + req.url }));
      `,
      'app.config.ts': REGISTERED,
    });
    expect(addresses(graph)).toEqual(['GET ${apiUrl}/orders', 'GET /plain', 'GET https://status.example.test/health']);
    expect(requests(graph).find((node) => node.meta?.['path'] === '/orders')?.meta).toMatchObject({ baseUrlEnv: 'apiUrl', baseFrom: 'interceptor' });
    expect(rows(graph)).toEqual([]);
  });

  it('reads a class interceptor written as a template, behind a guard about absolute addresses', () => {
    const graph = extract({
      'api.interceptor.ts': `
        import { Injectable } from '@angular/core';
        import type { HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
        @Injectable()
        export class ApiInterceptor implements HttpInterceptor {
          intercept(req: HttpRequest<unknown>, next: HttpHandler) {
            if (req.url.startsWith('http')) return next.handle(req);
            return next.handle(req.clone({ url: \`/api/v1\${req.url}\` }));
          }
        }
      `,
      'app.module.ts': `
        import { HTTP_INTERCEPTORS } from '@angular/common/http';
        import { ApiInterceptor } from './api.interceptor';
        export const providers = [{ provide: HTTP_INTERCEPTORS, useClass: ApiInterceptor, multi: true }];
      `,
    });
    expect(addresses(graph)).toEqual(['GET /api/v1/orders', 'GET /plain', 'GET https://status.example.test/health']);
  });

  it('says so, and leaves every address partly read, when the rewrite depends on something else (P280)', () => {
    const graph = extract({
      'api.interceptor.ts': `
        import type { HttpInterceptorFn } from '@angular/common/http';
        import { environment } from './environment';
        export const apiInterceptor: HttpInterceptorFn = (req, next) => {
          if (req.headers.has('X-Raw')) return next(req);
          return next(req.clone({ url: \`\${environment.apiUrl}\${req.url}\` }));
        };
      `,
      'app.config.ts': REGISTERED,
    });
    expect(addresses(graph)).toContain('GET ${…}/orders');
    expect(requests(graph).find((node) => node.meta?.['url'] === '${…}/orders')?.meta).toMatchObject({ path: '/${…}/orders', baseFrom: 'interceptor' });
    // An address of its own host, and a request the client does not make, are as they were.
    expect(addresses(graph)).toEqual(expect.arrayContaining(['GET /plain', 'GET https://status.example.test/health']));
    expect(rows(graph)).toMatchObject([{ file: 'api.interceptor.ts', line: 6 }]);
    expect(rows(graph)[0]?.hint).toContain("only when req.headers.has('X-Raw')");
    expect(rows(graph)[0]?.hint).toContain('join nothing');
  });

  it('says so, and leaves every address partly read, when two interceptors rewrite the address (P280)', () => {
    const graph = extract({
      'api.interceptor.ts': `
        import type { HttpInterceptorFn } from '@angular/common/http';
        export const apiInterceptor: HttpInterceptorFn = (req, next) => next(req.clone({ url: '/a' + req.url }));
        export const otherInterceptor: HttpInterceptorFn = (req, next) => next(req.clone({ url: '/b' + req.url }));
      `,
      'app.config.ts': `${REGISTERED}\nexport const more = withInterceptors([otherInterceptor]);\nimport { otherInterceptor } from './api.interceptor';\n`,
    });
    expect(addresses(graph)).toContain('GET ${…}/orders');
    expect(rows(graph)).toHaveLength(2);
  });

  it('reads nothing from an interceptor nothing registers', () => {
    const graph = extract({
      'api.interceptor.ts': `
        import type { HttpInterceptorFn } from '@angular/common/http';
        export const apiInterceptor: HttpInterceptorFn = (req, next) => next(req.clone({ url: '/a' + req.url }));
      `,
    });
    expect(addresses(graph)).toContain('GET /orders');
    expect(rows(graph)).toEqual([]);
  });
});

const ASSETS = `
import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class CatalogService {
  constructor(private readonly http: HttpClient) {}
  icons() { return this.http.get('/assets/icons.json'); }
  item(id: string) { return this.http.get('/api/items/' + id); }
  page(slug: string) { return this.http.get(\`/pages/\${slug}\`); }
}
`;

describe("an interceptor's rewrite, read for the host it names and the addresses it is applied to (P280)", () => {
  it('puts a literal host and its path in front, the host recorded apart from the path', () => {
    const graph = extract({
      'api.interceptor.ts': `
        import type { HttpInterceptorFn } from '@angular/common/http';
        export const apiInterceptor: HttpInterceptorFn = (req, next) => next(req.clone({ url: \`https://api.example.test/api\${req.url}\` }));
      `,
      'app.config.ts': REGISTERED,
    });
    const orders = requests(graph).find((node) => String(node.meta?.['url']).endsWith('/api/orders'));
    expect(orders?.meta).toMatchObject({ url: 'https://api.example.test/api/orders', path: '/api/orders', host: 'api.example.test', baseFrom: 'interceptor' });
    expect(rows(graph)).toEqual([]);
  });

  it('applies the base to the addresses a guard that leaves does not send on as they are', () => {
    const graph = extract({
      'catalog.service.ts': ASSETS,
      'api.interceptor.ts': `
        import type { HttpInterceptorFn } from '@angular/common/http';
        export const apiInterceptor: HttpInterceptorFn = (req, next) => {
          if (req.url.startsWith('/assets/') || req.url === '/health') {
            return next(req);
          }
          return next(req.clone({ url: 'https://api.example.test' + req.url }));
        };
      `,
      'app.config.ts': REGISTERED,
    });
    expect(addresses(graph)).toEqual(
      expect.arrayContaining(['GET /assets/icons.json', 'GET https://api.example.test/api/items/:param', 'GET https://api.example.test/orders', 'GET https://api.example.test/pages/:param']),
    );
    expect(rows(graph)).toEqual([]);
  });

  it('applies the base only where the condition it is written under holds, and partly reads an address the test cannot tell', () => {
    const graph = extract({
      'catalog.service.ts': ASSETS,
      'api.interceptor.ts': `
        import type { HttpInterceptorFn } from '@angular/common/http';
        export const apiInterceptor: HttpInterceptorFn = (req, next) => {
          if (/^\\/(api|orders)/.test(req.url) && req.url !== '/orders/export') {
            return next(req.clone({ url: \`/gateway\${req.url}\` }));
          }
          return next(req);
        };
      `,
      'app.config.ts': REGISTERED,
    });
    expect(addresses(graph)).toEqual(
      expect.arrayContaining(['GET /assets/icons.json', 'GET ${…}/api/items/:param', 'GET /gateway/orders', 'GET ${…}/pages/:param']),
    );
    expect(rows(graph)).toEqual([]);
  });

  it('applies each side of an address chosen by a test of the address to the requests on that side, nested, a side keeping the address (P293)', () => {
    const graph = extract({
      'catalog.service.ts': ASSETS,
      'api.interceptor.ts': `
        import type { HttpInterceptorFn } from '@angular/common/http';
        export const apiInterceptor: HttpInterceptorFn = (req, next) =>
          next(req.clone({ url: req.url.startsWith('/api/') ? 'https://api.example.test' + req.url : req.url.startsWith('/assets/') ? req.url : \`/site\${req.url}\` }));
      `,
      'app.config.ts': REGISTERED,
    });
    expect(addresses(graph)).toEqual(
      expect.arrayContaining(['GET /assets/icons.json', 'GET https://api.example.test/api/items/:param', 'GET /site/orders', 'GET /site/pages/:param', 'GET https://status.example.test/health']),
    );
    expect(rows(graph)).toEqual([]);
  });

  it('applies each side of a base chosen by a test of the address, held in a const, and partly reads an address the test cannot tell (P293)', () => {
    const graph = extract({
      'admin.service.ts': `
        import { HttpClient } from '@angular/common/http';
        import { Injectable } from '@angular/core';
        @Injectable({ providedIn: 'root' })
        export class AdminService {
          constructor(private readonly http: HttpClient) {}
          users() { return this.http.get('/admin/users'); }
          any(section: string) { return this.http.get('/' + section); }
        }
      `,
      'api.interceptor.ts': `
        import type { HttpInterceptorFn } from '@angular/common/http';
        export const apiInterceptor: HttpInterceptorFn = (req, next) => {
          const base = req.url.includes('admin') ? '/office-rest' : '/store-rest';
          return next(req.clone({ url: base + req.url }));
        };
      `,
      'app.config.ts': REGISTERED,
    });
    expect(addresses(graph)).toEqual(expect.arrayContaining(['GET /office-rest/admin/users', 'GET /store-rest/orders', 'GET ${…}/:param']));
    expect(rows(graph)).toEqual([]);
  });

  it('is a row where the branch asks about something other than the address (P293)', () => {
    const graph = extract({
      'api.interceptor.ts': `
        import type { HttpInterceptorFn } from '@angular/common/http';
        export const apiInterceptor: HttpInterceptorFn = (req, next) => next(req.clone({ url: (req.headers.has('X-Admin') ? '/office-rest' : '/store-rest') + req.url }));
      `,
      'app.config.ts': REGISTERED,
    });
    expect(addresses(graph)).toContain('GET ${…}/orders');
    expect(rows(graph)).toHaveLength(1);
    expect(rows(graph)[0]?.hint).toContain("by a branch (req.headers.has('X-Admin'))");
  });

  it('reads text joined to a value with + as the address a template would spell', () => {
    const graph = extract({ 'catalog.service.ts': ASSETS });
    expect(addresses(graph)).toContain('GET /api/items/:param');
  });
});
