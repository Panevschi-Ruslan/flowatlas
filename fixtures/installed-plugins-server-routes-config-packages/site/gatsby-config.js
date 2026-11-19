module.exports = {
  plugins: [
    // A plugin of the site's, outside plugins/, listed by the path it resolves to.
    { resolve: require.resolve('./vendor/contact') },
    // An installed plugin whose package serves a function.
    'gatsby-plugin-forms',
  ],
};
