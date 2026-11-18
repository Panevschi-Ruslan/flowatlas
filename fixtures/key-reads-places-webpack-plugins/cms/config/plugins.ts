export default () => ({
  // A key resolving a dependency not installed by its package's name: one row, under the key.
  'color-kit': { enabled: true, resolve: 'strapi-plugin-colors' },
  // A local plugin the package.json also lists by a file: version: read here, no row for the dependency.
  notes: { enabled: true, resolve: './src/plugins/local-notes' },
  // A key spelled otherwise than the dependency's name: one row, under the key.
  mapView: { enabled: true },
  // A key no package is named after, beside a dependency not installed that no key names: one row naming it.
  'pdf-export': { enabled: true },
  boards: { enabled: true, resolve: './src/plugins/boards' },
  polls: { enabled: true, resolve: './src/plugins/polls' },
});
