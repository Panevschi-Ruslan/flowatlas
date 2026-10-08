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
import { routePathOfFile } from './fs-routes.js';

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
      'GET /': undefined,
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
    expect(byLabel.get('GET /')?.meta?.['registration']).toBe('routes/+layout.server');
    // A method has no node to point at, and says so; a page with neither export says nothing.
    expect(read.unresolved.map((row) => [row.reason, row.symbol])).toEqual([
      ['route-handler-unread', 'POST /orders/:param?/archive'],
    ]);
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
