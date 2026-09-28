import { describe, expect, it } from 'vitest';
import { fsAddressSpace, fsApplicationMap, pathPatternTest, routePathOfFile, type FsRouter } from './fs-routes.js';
import { MEDUSA_API } from './medusa-routes.js';
import { APP_ROUTER } from './nextjs-paths.js';

/**
 * What one shared reading, driven by a row per router, buys.
 *
 * Every test here asks the same function about two routers and gets two answers,
 * and that is the whole argument for the description: the difference between the
 * two frameworks is values, so it lives in values, and a change to the reading
 * moves both at once or neither.
 */
describe('routePathOfFile, over more than one router', () => {
  it('reads each router at its own root', () => {
    expect(routePathOfFile('src/api/admin/orders/route.ts', MEDUSA_API)).toBe('/admin/orders');
    expect(routePathOfFile('app/api/orders/route.ts', MEDUSA_API)).toBeNull();
    expect(routePathOfFile('src/api/admin/orders/route.ts', APP_ROUTER)).toBeNull();
  });

  it('turns a bracketed segment into a parameter for both', () => {
    expect(routePathOfFile('src/api/admin/orders/[id]/route.ts', MEDUSA_API)).toBe(
      '/admin/orders/:param',
    );
    expect(routePathOfFile('app/api/orders/[id]/route.ts', APP_ROUTER)).toBe('/api/orders/:param');
  });

  it('serves nothing under an underscore for either', () => {
    expect(routePathOfFile('src/api/store/_helpers/route.ts', MEDUSA_API)).toBeNull();
    expect(routePathOfFile('app/_components/orders/route.ts', APP_ROUTER)).toBeNull();
  });

  it('drops a bracketed group only for the router that has them', () => {
    // The distinction the description exists for. Two implementations would
    // agree here today and disagree the first time either was touched.
    expect(routePathOfFile('src/api/store/(group)/route.ts', MEDUSA_API)).toBe('/store/(group)');
    expect(routePathOfFile('app/(group)/store/route.ts', APP_ROUTER)).toBe('/store');
  });

  it('reads a catch-all only for the router that has one', () => {
    expect(routePathOfFile('app/api/[...slug]/route.ts', APP_ROUTER)).toBe('/api/*');
    expect(routePathOfFile('src/api/store/[...rest]/route.ts', MEDUSA_API)).toBe(
      '/store/[...rest]',
    );
  });

  it('answers only for the file name its router serves', () => {
    expect(routePathOfFile('src/api/admin/orders/helpers.ts', MEDUSA_API)).toBeNull();
  });

  it('serves a router below the service root at the address it serves', () => {
    // A plugin package with an address space of its own. The address is the one
    // the framework answers on wherever the package is loaded; which package
    // declared it is the application half of the id, not a segment of the path
    // (R125).
    expect(routePathOfFile('plugins/wishlist/src/api/store/wishlists/route.ts', MEDUSA_API)).toBe(
      '/store/wishlists',
    );
    const space = fsAddressSpace(fsApplicationMap(['src/api/store/wishlists/route.ts', 'plugins/wishlist/src/api/store/wishlists/route.ts'], [MEDUSA_API]));
    expect(space.addressOf('plugins/wishlist/src/api/store/wishlists/route.ts', MEDUSA_API)).toEqual(
      { path: '/store/wishlists', application: 'plugins/wishlist' },
    );
    expect(space.addressOf('src/api/store/wishlists/route.ts', MEDUSA_API)).toEqual({
      path: '/store/wishlists',
      application: '.',
    });
  });

  it('serves nothing that a router honouring no spelling would rename', () => {
    // A router with an empty list of spellings: every segment is itself.
    const literal: FsRouter = { root: 'api', routeFiles: ['route'], segments: [] };
    expect(routePathOfFile('api/[id]/_x/(g)/route.ts', literal)).toBe('/[id]/_x/(g)');
  });
});

describe('pathPatternTest', () => {
  it('covers what a star inside a segment was written to cover', () => {
    const covers = pathPatternTest('/admin*');
    expect(covers?.('/admin')).toBe(true);
    expect(covers?.('/admin/orders/:param')).toBe(true);
    expect(covers?.('/store/products')).toBe(false);
  });

  it('matches a parameter segment against one of any value', () => {
    const covers = pathPatternTest('/admin/orders/:id');
    expect(covers?.('/admin/orders/:param')).toBe(true);
    expect(covers?.('/admin/orders')).toBe(false);
  });

  it('declines a pattern it cannot turn into a test on an address', () => {
    expect(pathPatternTest('/((?!api).*)')).toBeUndefined();
    expect(pathPatternTest('admin')).toBeUndefined();
  });
});
