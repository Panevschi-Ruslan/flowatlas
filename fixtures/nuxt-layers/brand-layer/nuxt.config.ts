import { fileURLToPath } from 'node:url';

export default defineNuxtConfig({
  alias: {
    '#brand': fileURLToPath(new URL('./assets', import.meta.url)),
  },
});
