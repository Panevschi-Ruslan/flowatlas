export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  extends: [
    // A layer beside the application, by its path.
    '../ui-layer',
    // A package of the workspace, by its name, with options.
    ['brand-layer', { meta: { name: 'brand' } }],
    // Downloaded when the application builds: not read.
    'github:example/analytics-layer',
  ],
});
