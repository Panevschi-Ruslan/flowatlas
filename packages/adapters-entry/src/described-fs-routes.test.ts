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
    expect(routePathOfFile('src/routes/api/orders/+page.server.ts', SVELTEKIT_ROUTES)).toBeNull();

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
