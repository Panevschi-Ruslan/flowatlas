import { fileURLToPath } from 'node:url';

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  extends: ['github:example/storefront-base'],
  alias: {
    '#catalog': fileURLToPath(new URL('./app/catalog', import.meta.url)),
  },
  imports: {
    dirs: ['queries'],
  },
});
