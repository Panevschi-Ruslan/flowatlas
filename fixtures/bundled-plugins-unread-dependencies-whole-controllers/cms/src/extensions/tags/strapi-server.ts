export default (plugin) => {
  plugin.controllers.tag = ({ strapi }) => ({
    ...plugin.controllers.tag({ strapi }),
    async create(ctx) {
      ctx.body = await strapi.documents('plugin::tags.tag').create({ data: ctx.request.body });
    },
  });
  return plugin;
};
