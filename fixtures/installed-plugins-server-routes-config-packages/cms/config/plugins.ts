export default () => ({
  reviews: { enabled: true, resolve: './src/plugins/reviews' },
  // Resolved, but never enabled: Strapi does not load it.
  drafts: { resolve: './src/plugins/drafts' },
  ratings: { config: { maxScore: 5 } },
});
