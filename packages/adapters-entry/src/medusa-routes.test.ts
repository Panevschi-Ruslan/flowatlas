import {
  GraphBuilder,
  noAdapters,
  parseConfig,
  silentLogger,
  type EntryNode,
  type ExtractContext,
  type Unresolved,
} from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { medusaRoutesAdapter } from './medusa-routes.js';

interface Read {
  entries: EntryNode[];
  unresolved: Unresolved[];
}

const extract = (files: Record<string, string>): Read => {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: false },
  });
  for (const [path, source] of Object.entries(files)) project.createSourceFile(path, source);

  const ctx: ExtractContext = {
    repo: 'shop',
    repoDir: '/',
    service: { name: 'shop', repo: '/', type: 'medusa' },
    config: parseConfig({}),
    pkg: { dependencies: { '@medusajs/framework': '^2.21.1' } },
    project,
    checker: project.getTypeChecker(),
    builder: new GraphBuilder({ repo: 'shop' }),
    adapters: noAdapters,
    logger: silentLogger,
  };
  const entries = medusaRoutesAdapter.extractEntries(ctx);
  return { entries, unresolved: ctx.builder.build().unresolved };
};

const labels = (read: Read): string[] => read.entries.map((entry) => entry.label).sort();

const middlewareOf = (read: Read, label: string): unknown =>
  read.entries.find((entry) => entry.label === label)?.meta?.['middleware'];

const GET = 'export const GET = async (req, res) => { res.json([]); };';

describe('detection', () => {
  it('recognises either of the two packages the framework is spelled as', () => {
    expect(medusaRoutesAdapter.detect({ dependencies: { '@medusajs/medusa': '2.0.0' } }, undefined))
      .toBe(true);
    expect(
      medusaRoutesAdapter.detect({ devDependencies: { '@medusajs/framework': '2.0.0' } }, undefined),
    ).toBe(true);
    // The dependency the whole ticket is about: this framework brings Express
    // with it, and Express on its own is not this framework.
    expect(medusaRoutesAdapter.detect({ dependencies: { express: '4.21.2' } }, undefined)).toBe(
      false,
    );
  });
});

describe('the addresses a route file is served at', () => {
  it('reads every verb a route file exports, at the address of its directory', () => {
    const read = extract({
      '/src/api/admin/orders/route.ts': `${GET}\nexport const POST = async (req, res) => { res.json({}); };`,
      '/src/api/store/products/[id]/route.ts': GET,
    });
    expect(labels(read)).toEqual([
      'GET /admin/orders',
      'GET /store/products/:param',
      'POST /admin/orders',
    ]);
  });

  it('serves nothing from a file the router does not name or a subtree it opts out of', () => {
    const read = extract({
      '/src/api/store/helpers.ts': GET,
      '/src/api/store/_internal/route.ts': GET,
      '/src/services/orders.ts': GET,
    });
    expect(read.entries).toEqual([]);
  });

  it('says so when a route file exports no verb it can read', () => {
    const read = extract({ '/src/api/admin/dead/route.ts': 'export default { get() {} };' });
    expect(read.entries).toEqual([]);
    expect(read.unresolved.map((row) => row.reason)).toEqual(['route-verb-unread']);
  });
});

describe('the declarative middleware list', () => {
  it('names what one entry installs in front of the routes it covers', () => {
    const read = extract({
      '/src/api/middlewares.ts': `
        import { defineMiddlewares } from '@medusajs/framework';
        export default defineMiddlewares([
          { matcher: '/admin*', middlewares: [authenticate] },
        ]);
      `,
      '/src/api/admin/orders/route.ts': GET,
      '/src/api/store/products/route.ts': GET,
    });
    expect(middlewareOf(read, 'GET /admin/orders')).toEqual(['authenticate']);
    expect(middlewareOf(read, 'GET /store/products')).toBeUndefined();
  });

  it('follows a list assembled out of lists declared in other files', () => {
    // How the real application writes it: eighty-four consts, one per area, and
    // one list at the root that spreads them all.
    const read = extract({
      '/src/api/admin/orders/middlewares.ts': `
        export const adminOrderRoutesMiddlewares = [
          { matcher: '/admin/orders', middlewares: [validateBody({})] },
        ];
      `,
      '/src/api/middlewares.ts': `
        import { defineMiddlewares } from '@medusajs/framework';
        import { adminOrderRoutesMiddlewares } from './admin/orders/middlewares.js';
        export default defineMiddlewares([...adminOrderRoutesMiddlewares]);
      `,
      '/src/api/admin/orders/route.ts': GET,
    });
    expect(middlewareOf(read, 'GET /admin/orders')).toEqual(['validateBody']);
  });

  it('honours both spellings of the verbs an entry covers', () => {
    const read = extract({
      '/src/api/middlewares.ts': `
        import { defineMiddlewares } from '@medusajs/framework';
        export default defineMiddlewares({
          routes: [
            { matcher: '/admin/orders', methods: ['POST'], middlewares: [plural] },
            { matcher: '/store/products', method: 'GET', middlewares: [singular] },
          ],
        });
      `,
      '/src/api/admin/orders/route.ts': `${GET}\nexport const POST = async (req, res) => { res.json({}); };`,
      '/src/api/store/products/route.ts': `${GET}\nexport const POST = async (req, res) => { res.json({}); };`,
    });
    expect(middlewareOf(read, 'POST /admin/orders')).toEqual(['plural']);
    expect(middlewareOf(read, 'GET /admin/orders')).toBeUndefined();
    expect(middlewareOf(read, 'GET /store/products')).toEqual(['singular']);
    expect(middlewareOf(read, 'POST /store/products')).toBeUndefined();
  });

  it('reports a matcher it could not turn into a test rather than claiming one', () => {
    const read = extract({
      '/src/api/middlewares.ts': `
        import { defineMiddlewares } from '@medusajs/framework';
        export default defineMiddlewares([
          { matcher: /^\\/admin\\/.*$/, middlewares: [authenticate] },
        ]);
      `,
      '/src/api/admin/orders/route.ts': GET,
    });
    expect(middlewareOf(read, 'GET /admin/orders')).toBeUndefined();
    expect(read.unresolved.map((row) => row.reason)).toEqual(['middleware-matcher-unread']);
  });

  it('leaves out an entry that installs nothing it could name', () => {
    const read = extract({
      '/src/api/middlewares.ts': `
        import { defineMiddlewares } from '@medusajs/framework';
        export default defineMiddlewares([{ matcher: '/admin*', policies: [{ resource: 'order' }] }]);
      `,
      '/src/api/admin/orders/route.ts': GET,
    });
    expect(middlewareOf(read, 'GET /admin/orders')).toBeUndefined();
    expect(read.unresolved).toEqual([]);
  });

  it('never claims that what stands in front of a route was all read', () => {
    // The framework authenticates its own `/admin` and `/store` namespaces, and a
    // route file can switch that off with an `AUTHENTICATE` export. Neither is in
    // the list, so the reader says it did not read them.
    const read = extract({ '/src/api/admin/orders/route.ts': GET });
    expect(read.entries[0]?.meta?.['middlewareRead']).toBe(false);
  });
});
