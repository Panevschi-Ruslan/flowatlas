/** The order API's routes, written as a function Strapi calls with { strapi }. */
export default function orderRoutes() {
  return {
    routes: [
      {
        method: 'GET',
        path: '/orders/mine',
        handler: 'order.mine',
        config: { policies: ['global::is-signed-in'], middlewares: ['api::order.audit'] },
      },
    ],
  };
}
