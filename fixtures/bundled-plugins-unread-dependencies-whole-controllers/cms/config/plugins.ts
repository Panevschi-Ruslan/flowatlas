export default () => ({
  reviews: { enabled: true, resolve: './src/plugins/reviews' },
  // A dependency named as a plugin, turned off here: no row.
  notes: { enabled: false },
  'users-permissions': { config: { jwt: { expiresIn: '7d' } } },
});
