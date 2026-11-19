export default ({ strapi }) => ({
  async summary(ctx) {
    ctx.body = { count: 0 };
  },
  async settings(ctx) {
    ctx.body = { saved: true };
  },
});
