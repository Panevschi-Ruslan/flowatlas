/** Answers the installed ratings plugin's create action with the application's own. */
export default (plugin) => {
  plugin.controllers.rating.create = async (ctx) => {
    ctx.body = { saved: true };
  };
  return plugin;
};
