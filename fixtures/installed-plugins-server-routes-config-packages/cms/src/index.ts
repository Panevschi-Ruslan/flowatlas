/** Routes the application registers on Strapi's server itself. */
export default {
  register({ strapi }) {
    strapi.server.routes({
      type: 'content-api',
      routes: [{ method: 'GET', path: '/health', handler: 'api::order.order.health' }],
    });
  },
  bootstrap({ strapi }) {
    strapi.server.router.get('/ping', async (ctx) => {
      ctx.body = 'pong';
    });
  },
};
