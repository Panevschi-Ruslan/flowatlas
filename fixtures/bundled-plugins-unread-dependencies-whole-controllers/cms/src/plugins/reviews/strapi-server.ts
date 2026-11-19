const review = {
  async list(ctx) {
    ctx.body = [];
  },
  async remove(ctx) {
    ctx.body = { removed: ctx.params.id };
  },
};

const flag = {
  async mark(ctx) {
    ctx.body = { flagged: true };
  },
  async clear(ctx) {
    ctx.body = { flagged: false };
  },
};

export default {
  routes: {
    'content-api': {
      type: 'content-api',
      routes: [
        { method: 'GET', path: '/list', handler: 'review.list' },
        { method: 'DELETE', path: '/:id', handler: 'review.remove' },
        { method: 'POST', path: '/flag', handler: 'flag.mark' },
        { method: 'DELETE', path: '/flag', handler: 'flag.clear' },
      ],
    },
  },
  controllers: { review, flag },
};
