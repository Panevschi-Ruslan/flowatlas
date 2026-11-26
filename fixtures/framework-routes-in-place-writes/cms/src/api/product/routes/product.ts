import { factories } from '@strapi/strapi';

/** The product type's core routes, all but delete. */
export default factories.createCoreRouter('api::product.product', { except: ['delete'] });
