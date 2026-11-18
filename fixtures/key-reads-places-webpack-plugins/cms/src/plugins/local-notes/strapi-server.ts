export default {
  routes: { 'content-api': { type: 'content-api', routes: [{ method: 'GET', path: '/notes', handler: 'note.find' }] } },
  controllers: {
    note: {
      async find(ctx) {
        ctx.body = [];
      },
    },
  },
};
