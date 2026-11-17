/** Routes of the product API beside its core ones. */
export default {
  routes: [
    { method: 'GET', path: '/products/featured', handler: 'product.featured' },
    { method: 'POST', path: '/products/:id/archive', handler: 'api::product.product.archive' },
  ],
};
