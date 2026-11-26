import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::product.product', ({ strapi }) => ({
  /** The products, newest first, in place of the core action. */
  async find(ctx) {
    ctx.body = await strapi.documents('api::product.product').findMany({ sort: 'createdAt:desc' });
  },

  async featured(ctx) {
    ctx.body = await strapi.documents('api::product.product').findMany({ filters: { featured: true } });
  },
}));
