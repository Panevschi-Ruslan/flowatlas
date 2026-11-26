const review = {
  async latest(ctx) {
    ctx.body = [];
  },
};

export default {
  routes: {
    'content-api': {
      type: 'content-api',
      routes: [{ method: 'GET', path: '/latest', handler: 'review.latest' }],
    },
  },
  controllers: { review },
};
