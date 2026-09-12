/**
 * Two bases, on purpose.
 *
 * `apiUrl` is named by `services[web].apiTarget`, so everything rooted at it is
 * known to reach the gateway. `ordersUrl` is deliberately left unnamed, which is
 * what makes a request rooted at it ambiguous once two services answer its
 * route.
 */
export const environment = {
  production: false,
  apiUrl: 'https://gateway.example.test',
  ordersUrl: 'https://orders.example.test',
};
