/** The reviews plugin's routers: one on the content API, one on the admin API. */
export default {
  'content-api': {
    type: 'content-api',
    routes: [{ method: 'GET', path: '/summary', handler: 'review.summary' }],
  },
  admin: {
    type: 'admin',
    routes: [{ method: 'PUT', path: '/settings', handler: 'review.settings', config: { policies: ['can-edit'] } }],
  },
};
