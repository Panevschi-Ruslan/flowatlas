export default (plugin) => {
  // A fresh object: card written whole without create, lane the plugin's own, tag dropped.
  plugin.controllers = {
    card: {
      async find(ctx) {
        ctx.body = { polls: [] };
      },
    },
    lane: plugin.controllers.lane,
  };
  return plugin;
};
