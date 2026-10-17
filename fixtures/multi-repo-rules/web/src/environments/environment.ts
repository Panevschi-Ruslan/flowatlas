/**
 * Two bases, on purpose.
 *
 * `apiUrl` is named by `services[web].apiTarget` and reaches the gateway. In
 * this copy `ordersUrl` is named too, and reaches `orders` straight: the one
 * violation of `frontends-reach-only-edge`.
 */
export const environment = {
  production: false,
  apiUrl: 'https://gateway.example.test',
  ordersUrl: 'https://orders.example.test',
};
