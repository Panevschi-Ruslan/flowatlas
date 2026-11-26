export default {
  routes: [{ method: 'GET', path: '/pending', handler: 'draft.pending' }],
  controllers: {
    draft: {
      async pending(ctx) {
        ctx.body = [];
      },
    },
  },
};
