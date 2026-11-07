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

  it('says so, and puts no base in front, when the rewrite depends on something else', () => {
    const graph = extract({
      'api.interceptor.ts': `
        import type { HttpInterceptorFn } from '@angular/common/http';
        import { environment } from './environment';
        export const apiInterceptor: HttpInterceptorFn = (req, next) => {
          if (req.url.includes('assets')) return next(req);
          return next(req.clone({ url: \`\${environment.apiUrl}\${req.url}\` }));
        };
      `,
      'app.config.ts': REGISTERED,
    });
    expect(addresses(graph)).toContain('GET /orders');
    expect(rows(graph)).toMatchObject([{ file: 'api.interceptor.ts', line: 6 }]);
    expect(rows(graph)[0]?.hint).toContain("only when req.url.includes('assets')");
  });

  it('says so when two interceptors rewrite the address', () => {
    const graph = extract({
      'api.interceptor.ts': `
        import type { HttpInterceptorFn } from '@angular/common/http';
        export const apiInterceptor: HttpInterceptorFn = (req, next) => next(req.clone({ url: '/a' + req.url }));
        export const otherInterceptor: HttpInterceptorFn = (req, next) => next(req.clone({ url: '/b' + req.url }));
      `,
      'app.config.ts': `${REGISTERED}\nexport const more = withInterceptors([otherInterceptor]);\nimport { otherInterceptor } from './api.interceptor';\n`,
    });
    expect(addresses(graph)).toContain('GET /orders');
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
