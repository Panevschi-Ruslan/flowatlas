import { orderedCount } from './orders-client';
import { findProduct, listProducts, reviewsOf } from './products';

const productFields = {
  reviews: (product: { id: string }) => reviewsOf(product.id),
  ordered: async () => orderedCount(),
};

export const resolvers = {
  Query: {
    products: () => listProducts(),
    product(_parent: unknown, args: { id: string }) {
      return findProduct(args.id);
    },
  },
  Product: { ...productFields },
};
