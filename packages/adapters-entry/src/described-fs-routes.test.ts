import {
  GraphBuilder,
  noAdapters,
  parseConfig,
  routeOf,
  silentLogger,
  type EntryAdapter,
  type EntryNode,
  type ExtractContext,
  type Unresolved,
} from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import {
  REMIX_ROUTES,
  remixRoutesAdapter,
  SVELTEKIT_ROUTES,
  sveltekitRoutesAdapter,
} from './described-fs-routes.js';
import { methodsCompared, routeAddressOfFile, routePathOfFile } from './fs-routes.js';
import { configuredRoutes, reactRouterRoutesAdapter } from './route-config.js';

interface Read {
  entries: EntryNode[];
  unresolved: Unresolved[];
}

const extract = (adapter: EntryAdapter, files: Record<string, string>): Read => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
  for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);
  const ctx: ExtractContext = {
    repo: 'web',
    repoDir: '/',
    service: { name: 'web', repo: '/', type: 'express' },
    config: parseConfig({}),
    pkg: {},
    project,
    checker: project.getTypeChecker(),
    builder: new GraphBuilder({ repo: 'web' }),
    adapters: noAdapters,
    logger: silentLogger,
  };
  const entries = adapter.extractEntries(ctx);
  return { entries, unresolved: ctx.builder.build().unresolved };
};

const rawPaths = (read: Read): Record<string, string | undefined> =>
  Object.fromEntries(read.entries.map((entry) => [entry.label, routeOf(entry).path]));

describe('SvelteKit routes', () => {
  it('reads +server files, groups, params with matchers and the rest', () => {
    expect(routePathOfFile('src/routes/api/orders/+server.ts', SVELTEKIT_ROUTES)).toBe('/api/orders');
    expect(routePathOfFile('src/routes/(shop)/api/orders/[id=integer]/+server.ts', SVELTEKIT_ROUTES)).toBe(
      '/api/orders/:param',
    );
    expect(routePathOfFile('src/routes/api/orders/+page.server.ts', SVELTEKIT_ROUTES)).toBe('/api/orders');
    expect(routePathOfFile('src/routes/api/orders/+page.svelte', SVELTEKIT_ROUTES)).toBeNull();

    const read = extract(sveltekitRoutesAdapter, {
      '/src/routes/api/orders/[id=integer]/+server.ts':
        'export async function GET({ params }) { return new Response(params.id); }\nexport const DELETE = async () => new Response(null);',
      '/src/routes/[[lang]]/files/[...path]/+server.ts': 'export function GET() { return new Response(); }',
    });
    expect(rawPaths(read)).toEqual({
      'DELETE /api/orders/:param': '/api/orders/:id',
      'GET /api/orders/:param': '/api/orders/:id',
      'GET /:param/files/*': '/:lang?/files/:path',
    });
  });
});

describe('SvelteKit pages', () => {
  it('reads a load as a GET and each action as a POST, a named one at ?/name', () => {
    const read = extract(sveltekitRoutesAdapter, {
      '/src/lib/forms.ts': 'export async function subscribe({ request }) { return request.formData(); }',
      '/src/routes/orders/[id]/+page.server.ts': [
        "import { subscribe } from '../../../lib/forms';",
        'export const load = async ({ params }) => ({ id: params.id });',
        'export const actions = {',
        '  default: async ({ params }) => ({ id: params.id }),',
        '  subscribe,',
        '  rename: renameOrder,',
        '  async archive() { return null; },',
        '} satisfies Record<string, unknown>;',
        'function renameOrder() { return null; }',
      ].join('\n'),
      '/src/routes/(shop)/+layout.server.ts': "export const load = () => ({ section: 'shop' });",
      '/src/routes/about/+page.server.ts': 'export const prerender = true;',
    });
    expect(rawPaths(read)).toEqual({
      'GET / (layout)': '/',
      'GET /orders/:param': '/orders/:id',
      'POST /orders/:param': '/orders/:id',
      'POST /orders/:param?/archive': '/orders/:id',
      'POST /orders/:param?/rename': '/orders/:id',
      'POST /orders/:param?/subscribe': '/orders/:id',
    });
    const byLabel = new Map(read.entries.map((entry) => [entry.label, entry]));
    expect(byLabel.get('POST /orders/:param?/rename')?.key).toBe('POST:/orders/:param?/rename');
    expect(byLabel.get('POST /orders/:param?/rename')?.meta?.['action']).toBe('rename');
    expect(byLabel.get('POST /orders/:param?/rename')?.handler).toMatchObject({ functionName: 'renameOrder' });
    expect(byLabel.get('POST /orders/:param?/subscribe')?.handler).toMatchObject({ functionName: 'subscribe' });
    expect(byLabel.get('POST /orders/:param')?.handler).toMatchObject({ inline: true });
    expect(byLabel.get('POST /orders/:param')?.meta?.['registration']).toBe('routes/+page.server');
    expect(byLabel.get('GET / (layout)')?.meta?.['registration']).toBe('routes/+layout.server');
    // A method has no node to point at, and says so; a page with neither export says nothing.
    expect(read.unresolved.map((row) => [row.reason, row.symbol])).toEqual([
      ['route-handler-unread', 'POST /orders/:param?/archive'],
    ]);
  });

  it('answers a load and an action with what they return, and a +server verb only through json', () => {
    const read = extract(sveltekitRoutesAdapter, {
      '/src/routes/+layout.server.ts': "export const load = () => ({ section: 'shop' });",
      '/src/routes/orders/+page.server.ts': 'export const load = () => ({ orders: [] });',
      '/src/routes/api/orders/+server.ts': 'export function GET() { return new Response(); }',
    });
    const answersOf = (label: string) =>
      read.entries.find((entry) => entry.label === label)?.request?.answers.map((answer) => answer.by);
    expect(answersOf('GET / (layout)')).toEqual(['named', 'return']);
    expect(answersOf('GET /orders')).toEqual(['named', 'return']);
    expect(answersOf('GET /api/orders')).toEqual(['named']);
    expect(rawPaths(read)['GET / (layout)']).toBe('/');
  });

  it('keeps a layout, a page and a verb at one address apart, and says a second claim', () => {
    const read = extract(sveltekitRoutesAdapter, {
      '/src/routes/+layout.server.ts': "export const load = () => ({ section: 'root' });",
      '/src/routes/(shop)/+layout.server.ts': "export const load = () => ({ section: 'shop' });",
      '/src/routes/(shop)/+page.server.ts': 'export const load = () => ({ page: 1 });',
      '/src/routes/about/+page.server.ts': 'export const load = () => ({ about: true });',
      '/src/routes/about/+server.ts': 'export function GET() { return new Response(); }',
      '/src/routes/(a)/cart/+server.ts': 'export function POST() { return new Response(); }',
      '/src/routes/(b)/cart/+server.ts': 'export function POST() { return new Response(); }',
    });
    const byKey = Object.fromEntries(
      read.entries.map((entry) => [entry.key, [entry.meta?.['registration'], entry.meta?.['contributes']]]),
    );
    expect(byKey).toEqual({
      'GET:/': ['routes/+page.server', undefined],
      'GET:/#layout:src/routes/+layout.server.ts': ['routes/+layout.server', 'layout'],
      'GET:/#layout:src/routes/(shop)/+layout.server.ts': ['routes/+layout.server', 'layout'],
      'GET:/about': ['routes/+server', undefined],
      'GET:/about#page': ['routes/+page.server', 'page'],
      'POST:/cart': ['routes/+server', undefined],
    });
    expect(read.unresolved.map((row) => [row.reason, row.file])).toEqual([
      ['route-claimed-twice', 'src/routes/(b)/cart/+server.ts'],
    ]);
  });

  it('reads a segment holding a param as one, and escaped characters as themselves', () => {
    expect(routeAddressOfFile('src/routes/foo-[id]/+server.ts', SVELTEKIT_ROUTES)).toEqual({
      path: '/foo-:param',
      rawPath: '/foo-:id',
    });
    expect(routeAddressOfFile('src/routes/[a]-[b=integer]/+server.ts', SVELTEKIT_ROUTES)).toEqual({
      path: '/:param-:param',
      rawPath: '/:a-:b',
    });
    expect(routePathOfFile('src/routes/[x+2e]well-known/+server.ts', SVELTEKIT_ROUTES)).toBe('/.well-known');
    expect(routePathOfFile('src/routes/caf[u+00e9]/+server.ts', SVELTEKIT_ROUTES)).toBe('/café');
    expect(routePathOfFile('src/routes/[a]-[b=integer]/+server.ts', SVELTEKIT_ROUTES)).toBe('/:param-:param');
    expect(routePathOfFile('src/routes/[[lang]]/+server.ts', SVELTEKIT_ROUTES)).toBe('/:param');
  });

  it('reads an escape that stands for no character as the text it is, and never throws', () => {
    expect(routePathOfFile('src/routes/[x+110000]/+server.ts', SVELTEKIT_ROUTES)).toBe('/[x+110000]');
    expect(routePathOfFile('src/routes/a[u+1234567]/+server.ts', SVELTEKIT_ROUTES)).toBe('/a[u+1234567]');
    expect(routePathOfFile('src/routes/a[x+ffffffffffff]b/+server.ts', SVELTEKIT_ROUTES)).toBe('/a[x+ffffffffffff]b');
    expect(routePathOfFile('src/routes/[u+10ffff]/+server.ts', SVELTEKIT_ROUTES)).toBe(`/${String.fromCodePoint(0x10ffff)}`);
  });

  it('keeps an escape for a character an address reads as syntax encoded', () => {
    expect(routeAddressOfFile('src/routes/what[x+3f]/+server.ts', SVELTEKIT_ROUTES)).toEqual({ path: '/what%3F', rawPath: '/what%3F' });
    expect(routeAddressOfFile('src/routes/a[x+3a]b/+server.ts', SVELTEKIT_ROUTES)).toEqual({ path: '/a%3Ab', rawPath: '/a%3Ab' });
    expect(routeAddressOfFile('src/routes/a[x+2f]b/+server.ts', SVELTEKIT_ROUTES)).toEqual({ path: '/a%2Fb', rawPath: '/a%2Fb' });
    expect(routeAddressOfFile('src/routes/[id][x+3a]x/+server.ts', SVELTEKIT_ROUTES)).toEqual({
      path: '/:param%3Ax',
      rawPath: '/:id%3Ax',
    });
  });

  it('keeps siblings with literal text around a param apart, and apart from a bare param', () => {
    const read = extract(sveltekitRoutesAdapter, {
      '/src/routes/foo-[id]/+server.ts': 'export function GET() { return new Response(); }',
      '/src/routes/bar-[id]/+server.ts': 'export function GET() { return new Response(); }',
      '/src/routes/[id]/+server.ts': 'export function GET() { return new Response(); }',
    });
    expect(read.entries.map((entry) => entry.key).sort()).toEqual(['GET:/:param', 'GET:/bar-:param', 'GET:/foo-:param']);
    expect(read.unresolved).toEqual([]);
  });
});

describe('Remix routes', () => {
  it('reads flat names, folders, layouts and dollars', () => {
    expect(routePathOfFile('app/routes/api.orders.$id.ts', REMIX_ROUTES)).toBe('/api/orders/:param');
    expect(routePathOfFile('app/routes/_auth.login.tsx', REMIX_ROUTES)).toBe('/login');
    expect(routePathOfFile('app/routes/api.orders._index/route.ts', REMIX_ROUTES)).toBe('/api/orders');
    expect(routePathOfFile('app/routes/api.orders._index/form.tsx', REMIX_ROUTES)).toBeNull();
    expect(routePathOfFile('app/routes/[sitemap.xml].ts', REMIX_ROUTES)).toBe('/sitemap.xml');
    expect(routePathOfFile('app/routes/files.$.ts', REMIX_ROUTES)).toBe('/files/*');
    expect(routePathOfFile('app/routes/orders_.$id.edit.tsx', REMIX_ROUTES)).toBe('/orders/:param/edit');
  });

  it('reads what is left of a segment opting out of its layout, partial escapes and optional literals', () => {
    expect(routeAddressOfFile('app/routes/users.$userId_.edit.tsx', REMIX_ROUTES)).toEqual({
      path: '/users/:param/edit',
      rawPath: '/users/:userId/edit',
    });
    expect(routePathOfFile('app/routes/sitemap[.]xml.tsx', REMIX_ROUTES)).toBe('/sitemap.xml');
    expect(routeAddressOfFile('app/routes/(en).about.tsx', REMIX_ROUTES)).toEqual({
      path: '/en/about',
      rawPath: '/en?/about',
    });
    expect(routeAddressOfFile('app/routes/($lang).about.tsx', REMIX_ROUTES)).toEqual({
      path: '/:param/about',
      rawPath: '/:lang?/about',
    });
  });

  it('turns a loader into a GET and an action into a POST, and a page into nothing', () => {
    const read = extract(remixRoutesAdapter, {
      '/app/routes/api.orders.$orderId.ts':
        'export async function loader({ params }) { return { id: params.orderId }; }\nexport async function action({ request }) { return null; }',
      '/app/routes/($lang).about.tsx': 'export default function About() { return null; }',
    });
    expect(rawPaths(read)).toEqual({
      'GET /api/orders/:param': '/api/orders/:orderId',
      'POST /api/orders/:param': '/api/orders/:orderId',
    });
    expect(read.unresolved.filter((row) => row.reason === 'route-verb-unread')).toEqual([]);
  });
});

describe('Remix actions by method', () => {
  it('keys an action by the verbs it compares request.method to, else POST', () => {
    const read = extract(remixRoutesAdapter, {
      '/app/routes/api.orders.$id.ts': [
        'export async function action({ request }) {',
        "  if (request.method === 'DELETE') return null;",
        '  switch (request.method.toUpperCase()) {',
        "    case 'PUT': return null;",
        "    case 'patch': return null;",
        '  }',
        "  if (request.method === someVerb) return null;",
        '  return null;',
        '}',
      ].join('\n'),
      '/app/routes/api.carts.ts': 'export async function action({ request }) { return request.json(); }',
    });
    expect(Object.keys(rawPaths(read)).sort()).toEqual([
      'DELETE /api/orders/:param',
      'PATCH /api/orders/:param',
      'POST /api/carts',
      'PUT /api/orders/:param',
    ]);
  });

  it('reads only literal verbs compared to a method', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const file = project.createSourceFile(
      '/a.ts',
      "const { method } = req; if (method !== 'post') {} if (kind === 'GET') {} if (req.method == 'NOPE') {}",
    );
    expect(methodsCompared(file)).toEqual(['POST']);
  });
});

describe('React Router route config', () => {
  const CONFIG = [
    "import { index, layout, prefix, route, type RouteConfig } from '@react-router/dev/routes';",
    'export default [',
    "  index('routes/home.tsx'),",
    "  route('orders/:orderId', 'routes/order.tsx', [route('edit', 'routes/order-edit.tsx')]),",
    "  layout('routes/auth.tsx', [route('login', 'routes/login.tsx')]),",
    "  ...prefix('api', [index('routes/api/root.ts'), route('carts/:cartId?', 'routes/api/cart.ts'), route('files/*', './routes/api/files.ts')]),",
    "  route(path, 'routes/unknown.tsx'),",
    '] satisfies RouteConfig;',
  ].join('\n');

  it('reads each helper into a module and an address', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const routes = configuredRoutes(project.createSourceFile('/app/routes.ts', CONFIG));
    expect(routes.map(({ module, rawPath }) => ({ module, rawPath }))).toEqual([
      { module: 'routes/home.tsx', rawPath: '/' },
      { module: 'routes/order.tsx', rawPath: '/orders/:orderId' },
      { module: 'routes/order-edit.tsx', rawPath: '/orders/:orderId/edit' },
      { module: 'routes/auth.tsx', rawPath: '/' },
      { module: 'routes/login.tsx', rawPath: '/login' },
      { module: 'routes/api/root.ts', rawPath: '/api' },
      { module: 'routes/api/cart.ts', rawPath: '/api/carts/:cartId?' },
      { module: './routes/api/files.ts', rawPath: '/api/files/*' },
    ]);
  });

  it('reads the modules the config names as ways in', () => {
    const read = extract(reactRouterRoutesAdapter, {
      '/app/routes.ts': CONFIG,
      '/app/routes/order.tsx':
        'export async function loader({ params }) { return params.orderId; }\nexport default function Order() { return null; }',
      '/app/routes/api/cart.ts':
        "export async function action({ request, params }) { if (request.method === 'DELETE') return params.cartId; return null; }",
      '/app/routes/api/files.ts': 'export const loader = () => null;',
      '/app/routes/login.tsx': 'export default function Login() { return null; }',
    });
    expect(rawPaths(read)).toEqual({
      'GET /orders/:param': '/orders/:orderId',
      'DELETE /api/carts/:param': '/api/carts/:cartId?',
      'GET /api/files/*': '/api/files/*',
    });
    expect(read.entries[0]?.meta?.['registration']).toBe('routes.ts/route-config');
    // A module the config names and the project does not have is a row, at the line naming it.
    expect(read.unresolved.map((row) => [row.reason, row.symbol, row.line])).toEqual([
      ['route-module-not-found', 'routes/home.tsx', 3],
      ['route-module-not-found', 'routes/order-edit.tsx', 4],
      ['route-module-not-found', 'routes/auth.tsx', 5],
      ['route-module-not-found', 'routes/api/root.ts', 6],
    ]);
  });

  it('reads flatRoutes() by the flat convention, at the root, spread and under a prefix', () => {
    const read = extract(reactRouterRoutesAdapter, {
      '/app/routes.ts': [
        "import { prefix, route, type RouteConfig } from '@react-router/dev/routes';",
        "import { flatRoutes } from '@react-router/fs-routes';",
        'export default [',
        '  ...(await flatRoutes()),',
        "  ...prefix('admin', await flatRoutes({ rootDirectory: 'admin' })),",
        '] satisfies RouteConfig;',
      ].join('\n'),
      '/app/routes/api.orders.$orderId.ts': 'export const loader = ({ params }) => params.orderId;',
      '/app/routes/_index.tsx': 'export default function Home() { return null; }',
      '/app/admin/users.$id/route.ts': 'export const action = () => null;',
      '/app/models/orders.ts': 'export const loader = () => null;',
    });
    expect(rawPaths(read)).toEqual({
      'GET /api/orders/:param': '/api/orders/:orderId',
      'POST /admin/users/:param': '/admin/users/:id',
    });
    expect(read.unresolved).toEqual([]);

    const project = new Project({ useInMemoryFileSystem: true });
    const whole = project.createSourceFile('/app/routes.ts', "export default flatRoutes() satisfies RouteConfig;");
    expect(configuredRoutes(whole, (root) => [{ module: `${root}/_index.tsx`, rawPath: '/' }])).toEqual([
      { module: 'routes/_index.tsx', rawPath: '/', line: 1 },
    ]);
  });
});
