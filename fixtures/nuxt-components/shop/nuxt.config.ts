import { fileURLToPath } from 'node:url';

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  // A layer beside the application, its path built from this file.
  extends: [fileURLToPath(new URL('../base-layer', import.meta.url))],
  modules: [
    // A package from a registry, whose components are its own.
    '@nuxt/image',
    // A module of the repository, handed an option that turns its route off.
    ['./modules/reviews', { enabled: false }],
    // A module of the workspace, whose manifest names only its build.
    'catalog-kit',
  ],
  // The options `catalog-kit` reads, by its `configKey`.
  catalog: { search: true },
  // Nuxt's own `components/`, and two more directories named their own way.
  components: [{ path: '~/components/ui', prefix: 'Ui' }, { path: '~/components/flat', pathPrefix: false }, '~/components'],
});
