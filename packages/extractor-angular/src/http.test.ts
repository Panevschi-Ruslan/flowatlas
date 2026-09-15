import {
  GraphBuilder,
  noAdapters,
  parseConfig,
  silentLogger,
  type ExtractContext,
  type GraphNode,
  type RepoGraph,
  type ServiceConfig,
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
  put<T>(url: string, body: unknown, options?: unknown): Observable<T>;
  patch<T>(url: string, body: unknown, options?: unknown): Observable<T>;
  delete<T>(url: string, options?: unknown): Observable<T>;
  request<T>(method: string, url: string, options?: unknown): Observable<T>;
}
`;

const ENVIRONMENT = `export const environment = { apiUrl: 'https://api.test', otherUrl: 'https://other.test' };`;

const PREAMBLE = `
import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from './environment';

export interface OrderDto { id: string }
export interface CreateOrderDto { customerId: string }
`;

const extract = (
  body: string,
  service: Partial<ServiceConfig> = {},
  /** Whole classes, for the shapes that need more than one. */
  extra = '',
): RepoGraph => {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('node_modules/@angular/core/index.d.ts', CORE);
  project.createSourceFile('node_modules/@angular/core/package.json', '{"name":"@angular/core"}');
  project.createSourceFile('node_modules/@angular/common/http/index.d.ts', HTTP);
  project.createSourceFile('node_modules/@angular/common/package.json', '{"name":"@angular/common"}');
  project.createSourceFile('node_modules/rxjs/index.d.ts', RXJS);
  project.createSourceFile('node_modules/rxjs/package.json', '{"name":"rxjs"}');
  project.createSourceFile('environment.ts', ENVIRONMENT);
  project.createSourceFile(
    'orders-api.service.ts',
    `${PREAMBLE}
@Injectable({ providedIn: 'root' })
export class OrdersApiService {
  private readonly base = environment.apiUrl;
  constructor(private readonly http: HttpClient) {}
${body}
}
${extra}
`,
  );

  const builder = new GraphBuilder({ repo: 'web', generatedAt: '2026-01-01T00:00:00.000Z' });
  const base: ExtractContext = {
    repo: 'web',
    repoDir: '/',
    service: { name: 'web', repo: '.', type: 'angular', ...service },
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

const callsOf = (graph: RepoGraph): GraphNode[] =>
  graph.nodes.filter((node) => node.type === 'ui_api_call');

const only = (graph: RepoGraph): GraphNode => {
  const [call] = callsOf(graph);
  if (call === undefined) throw new Error('no request was recorded');
  return call;
};

const reasons = (graph: RepoGraph): string[] => graph.unresolved.map((row) => row.reason);

describe('requests the browser makes', () => {
  it('reads every verb the client offers', () => {
    const graph = extract(`
  a(): Observable<OrderDto> { return this.http.get<OrderDto>('/a'); }
  b(): Observable<OrderDto> { return this.http.post<OrderDto>('/b', {}); }
  c(): Observable<OrderDto> { return this.http.put<OrderDto>('/c', {}); }
  d(): Observable<OrderDto> { return this.http.patch<OrderDto>('/d', {}); }
  e(): Observable<OrderDto> { return this.http.delete<OrderDto>('/e'); }
  f(): Observable<OrderDto> { return this.http.request<OrderDto>('HEAD', '/f'); }
`);
    expect(callsOf(graph).map((call) => `${String(call.meta?.['method'])} ${String(call.meta?.['path'])}`).sort()).toEqual([
      'DELETE /e',
      'GET /a',
      'HEAD /f',
      'PATCH /d',
      'POST /b',
      'PUT /c',
    ]);
  });

  it('registers the type of the answer, taken from the call itself', () => {
    const graph = extract(`  a(): Observable<OrderDto> { return this.http.get<OrderDto>('/a'); }`);
    expect(only(graph).meta?.['responseType']).toBe('type:web#OrderDto');
    expect(Object.keys(graph.types)).toContain('type:web#OrderDto');
  });

  it('unwraps the delivery when the type is only on the return', () => {
    const graph = extract(`  a(): Observable<OrderDto> { return this.http.get('/a') as Observable<OrderDto>; }`);
    expect(only(graph).meta?.['responseType']).toBe('type:web#OrderDto');
  });

  it('takes the body type from what the parameter is declared as', () => {
    const graph = extract(`
  a(body: CreateOrderDto): Observable<OrderDto> { return this.http.post<OrderDto>('/a', body); }
`);
    expect(only(graph).meta?.['bodyType']).toBe('type:web#CreateOrderDto');
  });

  it('roots an address at the settings key it starts with', () => {
    const graph = extract(
      `  a(id: string): Observable<OrderDto> { return this.http.get<OrderDto>(\`\${environment.apiUrl}/orders/\${id}\`); }`,
    );
    expect(only(graph).meta).toMatchObject({
      path: '/orders/:param',
      baseUrlEnv: 'apiUrl',
      via: 'template-env',
    });
  });

  it('names the annotation that would fix an address built at run time', () => {
    const graph = extract(
      `  a(path: string): Observable<unknown> { return this.http.get<unknown>(this.base + path); }`,
    );
    expect(only(graph).meta?.['path']).toBeNull();
    expect(reasons(graph)).toEqual(['api-path-dynamic']);
    expect(graph.unresolved[0]?.hint).toContain('@flowatlas-calls');
  });

  it('says so when the verb of a generic request is chosen at run time', () => {
    const graph = extract(
      `  a(method: string): Observable<unknown> { return this.http.request<unknown>(method, '/a'); }`,
    );
    expect(only(graph).meta?.['method']).toBeNull();
    expect(reasons(graph)).toEqual(['api-method-dynamic']);
  });

  it('records a third party as one, with a node of its own', () => {
    const graph = extract(
      `  a(): Observable<unknown> { return this.http.get<unknown>('https://api.stripe.test/v1/charges'); }`,
    );
    expect(only(graph).meta?.['host']).toBe('api.stripe.test');
    expect(graph.nodes.map((node) => node.id)).toContain('external_api:api.stripe.test');
  });

  it('asks for a settings key to be configured when the frontend declares others', () => {
    const graph = extract(
      `  a(): Observable<unknown> { return this.http.get<unknown>(\`\${environment.otherUrl}/a\`); }`,
      { apiBaseEnv: ['apiUrl'] },
    );
    expect(only(graph).meta?.['baseUrlEnv']).toBe('otherUrl');
    expect(reasons(graph)).toEqual(['api-base-unknown']);
  });

  it('says nothing about a settings key when the frontend declares none', () => {
    const graph = extract(
      `  a(): Observable<unknown> { return this.http.get<unknown>(\`\${environment.otherUrl}/a\`); }`,
    );
    expect(reasons(graph)).toEqual([]);
  });

  it('leaves a call on anything but the framework client alone', () => {
    const graph = extract(`  a(): Promise<unknown> { return fetch('/a').then((r) => r.json()); }`);
    expect(callsOf(graph)).toEqual([]);
  });
});

describe('annotations', () => {
  it('turns @flowatlas-calls into a request nothing else could see', () => {
    const graph = extract(`
  /** @flowatlas-calls PATCH /orders/:id/status */
  a(path: string): Observable<unknown> { return this.send(path); }
  private send(path: string): Observable<unknown> { return this.http.get<unknown>(this.base + path); }
`);
    const marked = callsOf(graph).find((call) => call.meta?.['via'] === 'marker');
    expect(marked?.meta).toMatchObject({ method: 'PATCH', path: '/orders/:param/status' });
    expect(graph.edges.find((edge) => edge.to === marked?.id)?.confidence).toBe('marker');
  });

  it('keeps the request it read over the one an annotation asserts', () => {
    const graph = extract(`
  /** @flowatlas-calls GET /orders */
  a(): Observable<OrderDto> { return this.http.get<OrderDto>('/orders'); }
`);
    expect(callsOf(graph)).toHaveLength(1);
    expect(callsOf(graph)[0]?.meta?.['via']).toBe('literal');
  });

  it('turns @flowatlas-consumes into a channel with a handler on it', () => {
    const graph = extract(`
  /** @flowatlas-consumes order.updated */
  a(order: OrderDto): void { this.seen = order; }
  private seen: OrderDto | null = null;
`);
    expect(graph.nodes.map((node) => node.id)).toContain('channel:order.updated');
    const consumes = graph.edges.find((edge) => edge.type === 'consumes');
    expect(consumes).toMatchObject({ from: 'channel:order.updated', confidence: 'marker' });
    expect(graph.edges.some((edge) => edge.type === 'handles' && edge.from === consumes?.to)).toBe(
      true,
    );
  });
});

const BASE_CLASS = `
export abstract class BaseApi {
  protected baseUrl = environment.apiUrl;
  constructor(protected readonly http: HttpClient) {}
  protected abstract resource(): string;
  protected urlFor(path: string = ''): string {
    const base = \`\${this.baseUrl}/admin/\${this.resource()}\`;
    return path ? \`\${base}/\${path}\` : base;
  }
}
`;

describe('an address a helper assembles', () => {
  it('keeps the path a property has already written, not just the key it is rooted at', () => {
    const graph = extract(`
  private readonly area = \`\${environment.apiUrl}/admin/platform\`;
  a(): Observable<OrderDto> { return this.http.get<OrderDto>(\`\${this.area}/depots\`); }
`);
    expect(only(graph).meta).toMatchObject({
      path: '/admin/platform/depots',
      baseUrlEnv: 'apiUrl',
    });
  });

  it('reads a fixed piece of the path kept in a field', () => {
    const graph = extract(`
  private readonly area = '/admin/upload';
  a(): Observable<OrderDto> { return this.http.get<OrderDto>(\`\${this.base}\${this.area}/preset\`); }
`);
    expect(only(graph).meta?.['path']).toBe('/admin/upload/preset');
  });

  it('follows a helper that takes arguments, and what each call passes it', () => {
    const graph = extract(`
  private url(id: string): string { return \`\${environment.apiUrl}/orders/\${id}/items\`; }
  a(id: string): Observable<OrderDto> { return this.http.get<OrderDto>(\`\${this.url(id)}/first\`); }
`);
    expect(only(graph).meta?.['path']).toBe('/orders/:param/items/first');
  });

  it('reads an address the helper returns whole, with no template around it', () => {
    const graph = extract(`
  private url(id: string): string { return \`\${environment.apiUrl}/orders/\${id}\`; }
  a(id: string): Observable<OrderDto> { return this.http.delete<OrderDto>(this.url(id)); }
`);
    expect(only(graph).meta?.['path']).toBe('/orders/:param');
  });

  it('asks the class that answered the helper, not the one that declared it', () => {
    const graph = extract(
      '',
      {},
      `${BASE_CLASS}
@Injectable({ providedIn: 'root' })
export class TablesApi extends BaseApi {
  protected resource(): string { return 'tables'; }
  a(): Observable<OrderDto> { return this.http.get<OrderDto>(this.urlFor('available')); }
}
`,
    );
    expect(only(graph).meta?.['path']).toBe('/admin/tables/available');
  });

  it('settles a helper that appends only when something was passed', () => {
    const graph = extract(
      '',
      {},
      `${BASE_CLASS}
@Injectable({ providedIn: 'root' })
export class ListApi extends BaseApi {
  protected resource(): string { return 'tables'; }
  all(): Observable<OrderDto> { return this.http.get<OrderDto>(this.urlFor()); }
  one(id: string): Observable<OrderDto> { return this.http.get<OrderDto>(this.urlFor(\`\${id}/rows\`)); }
}
`,
    );
    expect(callsOf(graph).map((call) => String(call.meta?.['path'])).sort()).toEqual([
      // Nothing was passed, so the default is the empty string and the branch
      // that appends is dead. Something was passed, and a string with literal
      // text in it is never empty, so the other branch is the one taken.
      '/admin/tables',
      '/admin/tables/:param/rows',
    ]);
  });

  it('takes the branch a caller wrote an argument for, and says it guessed', () => {
    const graph = extract(
      '',
      {},
      `${BASE_CLASS}
@Injectable({ providedIn: 'root' })
export class MaybeApi extends BaseApi {
  protected resource(): string { return 'tables'; }
  a(path: string): Observable<OrderDto> { return this.http.get<OrderDto>(this.urlFor(path)); }
}
`,
    );
    // Whether `path` is empty is the caller's business and nobody said. Writing
    // an argument at all is not asking for the default the guard exists for, so
    // the branch it takes is the answer — and the node says it was a guess, so
    // the edge the linker draws from it can say `heuristic` (R11).
    expect(only(graph).meta).toMatchObject({ path: '/admin/tables/:param', guessed: true });
  });

  it('says nothing about guessing where the caller settled the branch', () => {
    const graph = extract(
      '',
      {},
      `${BASE_CLASS}
@Injectable({ providedIn: 'root' })
export class PlainApi extends BaseApi {
  protected resource(): string { return 'tables'; }
  all(): Observable<OrderDto> { return this.http.get<OrderDto>(this.urlFor()); }
  one(id: string): Observable<OrderDto> { return this.http.get<OrderDto>(this.urlFor(\`\${id}/rows\`)); }
}
`,
    );
    expect(callsOf(graph).every((call) => call.meta?.['guessed'] === undefined)).toBe(true);
  });

  it('still stops where a helper nobody called anything is left open', () => {
    const graph = extract(
      '',
      {},
      `
export abstract class OpenBase {
  protected baseUrl = environment.apiUrl;
  constructor(protected readonly http: HttpClient) {}
  protected urlFor(path?: string): string {
    const base = \`\${this.baseUrl}/admin/tables\`;
    return path ? \`\${base}/\${path}\` : base;
  }
}
@Injectable({ providedIn: 'root' })
export class OpenApi extends OpenBase {
  a(): Observable<OrderDto> { return this.http.get<OrderDto>(this.urlFor()); }
}
`,
    );
    // Nothing was passed and there is no default, so nobody wrote an argument
    // to guess from. The two branches agree as far as they agree and the rest
    // stays a hole.
    expect(only(graph).meta).toMatchObject({ path: '/admin/tables${…}' });
    expect(only(graph).meta?.['guessed']).toBeUndefined();
  });

  it('will not call an unanswered method a route parameter', () => {
    const graph = extract(
      '',
      {},
      `${BASE_CLASS}
@Injectable({ providedIn: 'root' })
export class OpenApi extends BaseApi {
  protected resource(): string { return this.pick(); }
  private pick(): string { return Math.random() > 0.5 ? 'a' : 'b'; }
  a(): Observable<OrderDto> { return this.http.get<OrderDto>(this.urlFor('x')); }
}
`,
    );
    // `resource()` names one of the segments this project writes down, not a
    // value a route parameter accepts, so no route matches it.
    expect(String(only(graph).meta?.['path'])).toContain('${…}');
  });

  it('will not call a lookup a route parameter either', () => {
    const graph = extract(`
  a(paths: Record<string, string>, kind: string, id: string): Observable<OrderDto> {
    return this.http.get<OrderDto>(\`\${environment.apiUrl}/admin/\${paths[kind]}/\${id}\`);
  }
`);
    expect(only(graph).meta?.['path']).toBe('/admin/${…}/:param');
  });

  it('reads a lookup into a table written down as one request per entry it can name', () => {
    const graph = extract(`
  private readonly paths = { item: 'parcels', group: 'groups', zone: 'zones' } as const;
  a(kind: 'item' | 'group', id: string): Observable<OrderDto> {
    const path = this.paths[kind];
    return this.http.get<OrderDto>(\`\${environment.apiUrl}/admin/\${path}/\${id}\`);
  }
`);
    const calls = callsOf(graph);
    expect(calls.map((call) => call.meta?.['path']).sort()).toEqual([
      '/admin/groups/:param',
      '/admin/parcels/:param',
    ]);
    // One of them per run, and nothing says which: each is a guess.
    expect(calls.every((call) => call.meta?.['guessed'] === true)).toBe(true);
    expect(new Set(calls.map((call) => call.id)).size).toBe(2);
  });

  it('reads a table kept in a module constant through a wrapper', () => {
    const graph = extract(
      '',
      {},
      `
const ENTITY_PATH: Record<'item' | 'category', string> = { item: 'parcels', category: 'categories' };
@Injectable({ providedIn: 'root' })
export class Crate {
  private readonly api = environment.apiUrl;
  constructor(private readonly http: HttpClient) {}
  set(rid: string, type: 'item' | 'category', id: string): Observable<unknown> {
    const path = ENTITY_PATH[type];
    return this.http.put(\`\${this.api}/admin/\${rid}/\${path}/\${id}/crates\`, {});
  }
}
@Injectable({ providedIn: 'root' })
export class Tab {
  constructor(private readonly l10n: Crate, private type: 'item' | 'category') {}
  save(): void { this.l10n.set('r', this.type, 'x'); }
}
`,
    );
    const calls = callsOf(graph);
    expect(calls.map((call) => call.meta?.['path']).sort()).toEqual([
      '/admin/:param/categories/:param/crates',
      '/admin/:param/parcels/:param/crates',
    ]);
    // The lookup settles it where the request is written, so it stays there.
    expect(graph.edges.filter((edge) => calls.some((call) => call.id === edge.to)).every((edge) => edge.from.includes('Crate.set'))).toBe(true);
  });

  it('keeps calling a value a route parameter, whatever wraps it', () => {
    const graph = extract(`
  a(id: string): Observable<OrderDto> {
    return this.http.get<OrderDto>(\`\${environment.apiUrl}/orders/\${encodeURIComponent(id)}\`);
  }
`);
    expect(only(graph).meta?.['path']).toBe('/orders/:param');
  });
});


const PASS_THROUGH = `
export interface RequestOpts { params?: Record<string, string | undefined> }

@Injectable({ providedIn: 'root' })
export class ApiClient {
  readonly base = environment.apiUrl;
  constructor(private readonly http: HttpClient) {}
  get<T>(path: string, opts?: RequestOpts): Observable<T> {
    return this.http.get<T>(this.url(path, opts));
  }
  post<T>(path: string, body?: unknown, opts?: RequestOpts): Observable<T> {
    return this.http.post<T>(this.url(path, opts), body ?? {});
  }
  private url(path: string, opts?: RequestOpts): string {
    return \`\${this.base}\${path}\${opts?.params ? this.query(opts.params) : ''}\`;
  }
  private query(params: Record<string, string | undefined>): string {
    const s = new URLSearchParams(params as Record<string, string>).toString();
    return s ? \`?\${s}\` : '';
  }
}
`;

const TEMPLATE_METHOD = `
export abstract class AdminBase {
  protected baseUrl = environment.apiUrl || 'http://localhost:3000';
  constructor(protected readonly http: HttpClient) {}
  protected abstract getResourcePath(): string;
  protected requestWithTenant<T>(fn: (tenantId: string) => Observable<T>): Observable<T> {
    return fn('t1');
  }
  protected buildUrl(tenantId: string, path: string = ''): string {
    const resourcePath = this.getResourcePath();
    const basePath = \`\${this.baseUrl}/admin/\${tenantId}/\${resourcePath}\`;
    return path ? \`\${basePath}/\${path}\` : basePath;
  }
  protected get<T>(path: string = ''): Observable<T> {
    return this.requestWithTenant((tenantId) => this.http.get<T>(this.buildUrl(tenantId, path)));
  }
  protected post<T>(path: string, body: unknown): Observable<T> {
    return this.requestWithTenant((tenantId) => this.http.post<T>(this.buildUrl(tenantId, path), body));
  }
  /** Deleting is a post to the item's own delete action. */
  protected delete(path: string): Observable<void> {
    return this.requestWithTenant((tenantId) =>
      this.http.post<void>(this.buildUrl(tenantId, \`\${path}/delete\`), {}),
    );
  }
  protected postAction<T>(path: string, body: unknown): Observable<T> {
    return this.post<T>(path, body);
  }
  protected getWithParams<T>(path: string, params: Record<string, string>): Observable<T> {
    return this.requestWithTenant((tenantId) => {
      let url = this.buildUrl(tenantId, path);
      const query = new URLSearchParams(params).toString();
      if (query) {
        url += \`?\${query}\`;
      }
      return this.http.get<T>(url);
    });
  }
}
`;

describe('a request made through a wrapper', () => {
  it('reads the request at every call site of a client that takes the path', () => {
    const graph = extract(
      '',
      {},
      `${PASS_THROUGH}
@Injectable({ providedIn: 'root' })
export class DealsClient {
  constructor(private readonly api: ApiClient) {}
  deals(): Observable<OrderDto[]> { return this.api.get<OrderDto[]>('/telegram/me/deals'); }
  one(id: string): Observable<OrderDto> {
    return this.api.get<OrderDto>(\`/telegram/deals/\${id}\`, { params: { lang: 'en' } });
  }
  claim(id: string, body: CreateOrderDto): Observable<OrderDto> {
    return this.api.post<OrderDto>(\`/telegram/deals/\${id}/claim\`, body);
  }
}
`,
    );
    const calls = callsOf(graph);
    expect(calls.map((call) => `${String(call.meta?.['method'])} ${String(call.meta?.['path'])}`).sort()).toEqual([
      'GET /telegram/deals/:param',
      'GET /telegram/me/deals',
      'POST /telegram/deals/:param/claim',
    ]);
    expect(calls.every((call) => call.meta?.['baseUrlEnv'] === 'apiUrl')).toBe(true);
    expect(calls.every((call) => call.file === 'orders-api.service.ts')).toBe(true);
    // Attributed to the method that decided the address, not to the wrapper.
    const claim = calls.find((call) => call.meta?.['method'] === 'POST');
    expect(graph.edges.find((edge) => edge.to === claim?.id)?.from).toContain('DealsClient.claim');
    expect(claim?.meta).toMatchObject({
      bodyType: 'type:web#CreateOrderDto',
      responseType: 'type:web#OrderDto',
      through: 'ApiClient.post',
    });
    expect(reasons(graph)).toEqual([]);
  });

  it('answers an abstract resource with the subclass that calls the base helper', () => {
    const graph = extract(
      '',
      {},
      `${TEMPLATE_METHOD}
@Injectable({ providedIn: 'root' })
export class ItemsApi extends AdminBase {
  protected getResourcePath(): string { return 'parcels'; }
  list(): Observable<OrderDto[]> { return this.get<OrderDto[]>(); }
  one(id: string): Observable<OrderDto> { return this.get<OrderDto>(id); }
  remove(id: string): Observable<void> { return this.delete(id); }
  pause(id: string): Observable<OrderDto> { return this.postAction<OrderDto>(\`\${id}/pause\`, {}); }
  log(page: number): Observable<OrderDto[]> { return this.getWithParams<OrderDto[]>('chat-log', { page: String(page) }); }
}
@Injectable({ providedIn: 'root' })
export class TablesApi extends AdminBase {
  protected getResourcePath(): string { return 'tables'; }
  remove(id: string): Observable<void> { return this.delete(id); }
}
`,
    );
    expect(callsOf(graph).map((call) => `${String(call.meta?.['method'])} ${String(call.meta?.['path'])}`).sort()).toEqual([
      'GET /admin/:param/parcels',
      'GET /admin/:param/parcels/:param',
      'GET /admin/:param/parcels/chat-log',
      // The base's delete is a post to `<path>/delete`, whatever its name says.
      'POST /admin/:param/parcels/:param/delete',
      'POST /admin/:param/parcels/:param/pause',
      'POST /admin/:param/tables/:param/delete',
    ]);
    const pause = callsOf(graph).find((call) => String(call.meta?.['path']).endsWith('/pause'));
    expect(graph.edges.find((edge) => edge.to === pause?.id)?.from).toContain('ItemsApi.pause');
  });

  it('leaves a request whose path is a value where it is written', () => {
    const graph = extract(
      `  a(id: string): Observable<OrderDto> { return this.http.get<OrderDto>(\`\${environment.apiUrl}/orders/\${id}\`); }`,
      {},
      `
@Injectable({ providedIn: 'root' })
export class Screen {
  constructor(private readonly orders: OrdersApiService) {}
  open(): void { this.orders.a('o1'); }
}
`,
    );
    expect(graph.edges.find((edge) => edge.to === only(graph).id)?.from).toContain('OrdersApiService.a');
  });

  it('keeps both requests of a wrapper that writes two, each a guess', () => {
    const graph = extract(
      '',
      {},
      `
@Injectable({ providedIn: 'root' })
export class SaveClient {
  private readonly base = environment.apiUrl;
  constructor(private readonly http: HttpClient) {}
  save(path: string, body: CreateOrderDto, id?: string): Observable<OrderDto> {
    return id
      ? this.http.put<OrderDto>(\`\${this.base}\${path}/\${id}\`, body)
      : this.http.post<OrderDto>(\`\${this.base}\${path}\`, body);
  }
}
@Injectable({ providedIn: 'root' })
export class Items {
  constructor(private readonly client: SaveClient) {}
  create(body: CreateOrderDto): Observable<OrderDto> { return this.client.save('/items', body); }
}
`,
    );
    const calls = callsOf(graph);
    expect(calls.map((call) => `${String(call.meta?.['method'])} ${String(call.meta?.['path'])}`).sort()).toEqual([
      'POST /items',
      'PUT /items/:param',
    ]);
    expect(new Set(calls.map((call) => call.id)).size).toBe(2);
    expect(calls.every((call) => call.meta?.['guessed'] === true)).toBe(true);
  });

  it('keeps the wrapper row when a caller sits outside any method', () => {
    const graph = extract(
      '',
      {},
      `${PASS_THROUGH}
@Injectable({ providedIn: 'root' })
export class EarlyClient {
  readonly early: Observable<OrderDto[]>;
  constructor(private readonly api: ApiClient) {
    this.early = this.api.get<OrderDto[]>('/ctor/call');
  }
}
`,
    );
    expect(callsOf(graph).map((call) => call.meta?.['path'])).toEqual([null, null]);
    expect(reasons(graph).filter((reason) => reason === 'api-path-dynamic')).toHaveLength(2);
  });

  it('keeps the wrapper request when nothing calls the wrapper', () => {
    const graph = extract('', {}, PASS_THROUGH);
    expect(callsOf(graph)).toHaveLength(2);
    expect(callsOf(graph).map((call) => call.meta?.['path'])).toEqual([null, null]);
    expect(reasons(graph).filter((reason) => reason.startsWith('api-'))).toEqual(['api-path-dynamic', 'api-path-dynamic']);
  });
});

describe('an address another service assembles', () => {
  it('is read through the helper on the injected service, in that service', () => {
    const graph = extract(
      '',
      {},
      `
@Injectable({ providedIn: 'root' })
export class ExportUrls {
  private readonly api = environment.apiUrl;
  csvUrl(rid: string, locales: string[] = []): string {
    const qs = new URLSearchParams({ locales: locales.join(',') }).toString();
    return \`\${this.api}/admin/\${rid}/translations/export.csv\${qs ? \`?\${qs}\` : ''}\`;
  }
}
@Injectable({ providedIn: 'root' })
export class TranslationsPage {
  constructor(private readonly http: HttpClient, private readonly urls: ExportUrls) {}
  download(rid: string): Observable<string> { return this.http.get<string>(this.urls.csvUrl(rid)); }
}
`,
    );
    expect(only(graph).meta).toMatchObject({
      path: '/admin/:param/translations/export.csv',
      baseUrlEnv: 'apiUrl',
    });
  });
});

describe('a query string at the end of an address', () => {
  it('is no part of the route when it is only ever empty or opens with ?', () => {
    const graph = extract(`
  private qs(filters?: Record<string, string>): string {
    if (!filters) return '';
    const s = new URLSearchParams(filters).toString();
    return s ? \`?\${s}\` : '';
  }
  a(filters?: Record<string, string>): Observable<OrderDto[]> {
    const query = this.qs(filters);
    return this.http.get<OrderDto[]>(\`\${environment.apiUrl}/reviews\${query}\`);
  }
`);
    expect(only(graph).meta?.['path']).toBe('/reviews');
  });

  it('stays a hole when it could be anything', () => {
    const graph = extract(`
  a(tail: string): Observable<OrderDto[]> { return this.http.get<OrderDto[]>(\`\${environment.apiUrl}/reviews\${tail}\`); }
`);
    expect(only(graph).meta?.['path']).toBe('/reviews${…}');
  });
});

describe('a method nothing names', () => {
  it('is marked unreferenced, and one a constructor calls is not', () => {
    const graph = extract(
      `
  a(): Observable<OrderDto> { return this.http.get<OrderDto>(\`\${environment.apiUrl}/a\`); }
  b(): Observable<OrderDto> { return this.http.get<OrderDto>(\`\${environment.apiUrl}/b\`); }
`,
      {},
      `
@Injectable({ providedIn: 'root' })
export class Early {
  readonly first: Observable<OrderDto>;
  constructor(orders: OrdersApiService) { this.first = orders.b(); }
}
`,
    );
    const method = (name: string) => graph.nodes.find((node) => node.id.endsWith(`OrdersApiService.${name}`));
    expect(method('a')?.meta?.['unreferenced']).toBe(true);
    expect(method('b')?.meta?.['unreferenced']).toBeUndefined();
  });
});
