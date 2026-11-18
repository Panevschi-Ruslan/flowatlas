export default {
  routes: {
    'content-api': {
      type: 'content-api',
      routes: [
        { method: 'GET', path: '/cards', handler: 'card.find' },
        { method: 'POST', path: '/cards', handler: 'card.create' },
        { method: 'GET', path: '/lanes', handler: 'lane.find' },
        { method: 'GET', path: '/tags', handler: 'tag.find' },
      ],
    },
  },
  controllers: {
    card: {
      async find(ctx) {
        ctx.body = [];
      },
      async create(ctx) {
        ctx.body = {};
      },
    },
    lane: {
      async find(ctx) {
        ctx.body = [];
      },
    },
    tag: {
      async find(ctx) {
        ctx.body = [];
      },
    },
  },
};
