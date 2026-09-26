import { describe, expect, it } from 'vitest';
import { APP_PAGES, APP_ROUTER, PAGES_API, routePathOfFile } from './nextjs-paths.js';

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

  it('addresses a second application from where that application is', () => {
    // Two applications, each declaring the same route. Without the prefix both
    // claimed `/api/*` and the graph kept one of them; payload has thirty-nine
    // such applications and two hundred and seventy-one such declarations.
    expect(routePathOfFile('app/api/[...slug]/route.ts', APP_ROUTER)).toBe('/api/*');
    expect(routePathOfFile('test/fields/app/api/[...slug]/route.ts', APP_ROUTER)).toBe(
      '/test/fields/api/*',
    );
    expect(
      routePathOfFile('examples/auth/src/app/(payload)/api/graphql/route.ts', APP_ROUTER),
    ).toBe('/examples/auth/api/graphql');
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
