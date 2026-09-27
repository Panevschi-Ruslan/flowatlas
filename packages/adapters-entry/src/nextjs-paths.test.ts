import { describe, expect, it } from 'vitest';
import { fsAddressSpace, fsApplicationMap, routePathOfFile } from './fs-routes.js';
import { APP_PAGES, APP_ROUTER, PAGES_API } from './nextjs-paths.js';

describe('routePathOfFile', () => {
  it('serves the application at the service root at its own addresses', () => {
    expect(routePathOfFile('app/api/orders/route.ts', APP_ROUTER)).toBe('/api/orders');
    expect(routePathOfFile('src/app/api/orders/route.ts', APP_ROUTER)).toBe('/api/orders');
    expect(routePathOfFile('pages/api/orders.ts', PAGES_API)).toBe('/api/orders');
    expect(routePathOfFile('src/pages/api/index.ts', PAGES_API)).toBe('/api');
  });

  it('reads groups, slots, parameters and catch-alls', () => {
    expect(routePathOfFile('app/(admin)/invoices/route.ts', APP_ROUTER)).toBe('/invoices');
    expect(routePathOfFile('app/@modal/orders/route.ts', APP_ROUTER)).toBe('/orders');
    expect(routePathOfFile('app/api/orders/[id]/route.ts', APP_ROUTER)).toBe('/api/orders/:param');
    expect(routePathOfFile('app/api/[...slug]/route.ts', APP_ROUTER)).toBe('/api/*');
    expect(routePathOfFile('app/api/[[...slug]]/route.ts', APP_ROUTER)).toBe('/api/*');
  });

  it('serves nothing from a private directory or file', () => {
    expect(routePathOfFile('app/_components/orders/route.ts', APP_ROUTER)).toBeNull();
    expect(routePathOfFile('pages/api/_helper.ts', PAGES_API)).toBeNull();
  });

  it('answers only for the file names its router serves', () => {
    expect(routePathOfFile('app/orders/page.tsx', APP_ROUTER)).toBeNull();
    expect(routePathOfFile('app/orders/page.tsx', APP_PAGES)).toBe('/orders');
  });

  it('serves a second application at the addresses the framework serves it at', () => {
    // Two applications, each declaring the same route, and each declaring it at
    // the address the framework answers on. What tells them apart is the
    // identity, not the path (R125) — nothing serves `/test/fields/api/*`.
    expect(routePathOfFile('app/api/[...slug]/route.ts', APP_ROUTER)).toBe('/api/*');
    expect(routePathOfFile('test/fields/app/api/[...slug]/route.ts', APP_ROUTER)).toBe('/api/*');
    expect(
      routePathOfFile('examples/auth/src/app/(payload)/api/graphql/route.ts', APP_ROUTER),
    ).toBe('/api/graphql');
  });

  it('names the application an address belongs to, and only where there are two', () => {
    // The whole of the difference between the two mechanisms, in one place: the
    // segments in front of the router root are the application, and they decide
    // the id rather than the path. The judgement about whether an id carries one
    // at all is `applicationsServing`'s, which is why a service with a single
    // application is spelled exactly as it was before this change.
    const one = fsAddressSpace(fsApplicationMap(['app/api/orders/route.ts'], [APP_ROUTER]));
    expect(one.addressOf('app/api/orders/route.ts', APP_ROUTER)).toEqual({ path: '/api/orders' });

    const two = fsAddressSpace(fsApplicationMap(['app/api/orders/route.ts', 'examples/blog/src/app/api/orders/route.ts'], [APP_ROUTER]));
    expect(two.addressOf('app/api/orders/route.ts', APP_ROUTER)).toEqual({
      path: '/api/orders',
      application: '.',
    });
    expect(two.addressOf('examples/blog/src/app/api/orders/route.ts', APP_ROUTER)).toEqual({
      path: '/api/orders',
      application: 'examples/blog',
    });
    // Nothing there is not an address at all, whichever way the service is read.
    expect(two.addressOf('lib/orders.ts', APP_ROUTER)).toBeNull();
  });

  it('reads one application whichever of its two routers a file is under', () => {
    // `app/` and `pages/api/` in one application are one address space, so the
    // two routers must not read as two applications — an id that named one of
    // them would be an id nothing else in the repository agrees with.
    const space = fsAddressSpace(fsApplicationMap(['app/api/orders/route.ts', 'pages/api/legacy.ts'], [       APP_ROUTER,       PAGES_API,     ]));
    expect(space.addressOf('app/api/orders/route.ts', APP_ROUTER)).toEqual({ path: '/api/orders' });
    expect(space.addressOf('pages/api/legacy.ts', PAGES_API)).toEqual({ path: '/api/legacy' });
  });

  it('keeps an inner directory called app as the segment it is', () => {
    // The application's own `app/components/app/…`: one application, and the
    // second `app` is an ordinary part of the address.
    expect(routePathOfFile('app/api/app/route.ts', APP_ROUTER)).toBe('/api/app');
  });

  it('serves nothing from a file outside the service', () => {
    // A workspace package the service reads. A library has no address space, and
    // an application inside one belongs to whichever service that package is.
    expect(routePathOfFile('../../packages/lib/app/api/orders/route.ts', APP_ROUTER)).toBeNull();
  });
});
