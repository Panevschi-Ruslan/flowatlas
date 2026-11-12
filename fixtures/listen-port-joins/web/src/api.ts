import ky from 'ky';

/**
 * Stock: every request is made under `/stock` on the page's own origin, and a
 * hook sends it to the stock server instead, keeping its path.
 */
export const stockApi = ky.create({
  prefixUrl: '/stock',
  hooks: {
    beforeRequest: [(request) => new Request(request.url.replace(window.location.origin, 'http://localhost:3002'), request)],
  },
});

/** The storefront's basket: the request's path, resolved against the storefront's dev server. */
export const basketApi = ky.create({
  prefixUrl: '/api',
  hooks: {
    beforeRequest: [
      (request) => {
        const url = new URL(request.url);
        return new Request(new URL(url.pathname, 'http://localhost:3010'), request);
      },
    ],
  },
});
