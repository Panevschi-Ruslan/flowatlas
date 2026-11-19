export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  modules: [
    // Packages from a registry: named in a note, the first with what it adds.
    '@vueuse/nuxt',
    '@nuxtjs/i18n',
    // A module of the workspace, by its name.
    'audit-module',
    // Written as code: not read.
    process.env.EXTRA_MODULE ?? './modules/none',
  ],
  // The pages are in `app/views`, the code both halves share in `common/`.
  dir: { pages: 'views', shared: 'common' },
  extends: ['../admin-layer'],
  // Only when developing: compared with production, not read.
  $development: {
    extends: ['../dev-layer'],
  },
  $env: {
    staging: { dir: { pages: 'pages' } },
  },
});
