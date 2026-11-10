/**
 * Two bases, on purpose.
 *
 * `apiUrl` is named by `services[web].apiTarget`, so everything rooted at it is
 * known to reach the gateway. `ordersUrl` is deliberately left unnamed, and its
 * value here is a mirror no configured service is reached at (this file is read
 * for values since P280), which is what makes a request rooted at it ambiguous
 * once two services answer its route.
 */
export const environment = {
  production: false,
  apiUrl: 'https://gateway.example.test',
  ordersUrl: 'https://mirror.example.test',
};
