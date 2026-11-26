export default (plugin) => {
  const original = plugin.controllers.review;
  // The controller written whole, the plugin's own actions spread into it: list answered here, remove by the plugin.
  plugin.controllers.review = (opts) => ({
    ...original(opts),
    async list(ctx) {
      ctx.body = { items: [], page: 1 };
    },
  });
  // Written whole with no spread: clear is no longer answered.
  plugin.controllers.flag = {
    async mark(ctx) {
      ctx.body = { flagged: true, by: ctx.state.user?.id };
    },
  };
  return plugin;
};
