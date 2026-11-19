/** Adds a route to the local reviews plugin's content API router, answered here. */
export default (plugin) => {
  plugin.routes['content-api'].routes.push({ method: 'GET', path: '/top', handler: 'review.top' });
  plugin.controllers.review.top = async (ctx) => {
    ctx.body = [];
  };
  return plugin;
};
