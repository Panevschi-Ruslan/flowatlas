export default (plugin) => {
  const own = plugin.controllers;
  // The plugin's controllers written whole, its own spread in: lane is the plugin's, card's find answered here, its create the plugin's.
  plugin.controllers = {
    ...own,
    card: (opts) => ({
      ...own.card,
      async find(ctx) {
        ctx.body = { cards: [] };
      },
    }),
  };
  // A controller written over what is there.
  Object.assign(plugin.controllers, {
    tag: {
      async find(ctx) {
        ctx.body = { tags: [] };
      },
    },
  });
  return plugin;
};
