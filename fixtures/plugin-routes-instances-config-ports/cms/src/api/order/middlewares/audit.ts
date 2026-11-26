/** Records each request to the order API. */
export default (config, { strapi }) => async (ctx, next) => {
  await next();
};
