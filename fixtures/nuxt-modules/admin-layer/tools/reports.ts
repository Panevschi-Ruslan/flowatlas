import { addImportsDir, defineNuxtModule } from '@nuxt/kit';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export default defineNuxtModule({
  meta: { name: 'reports' },
  setup(_options, nuxt) {
    addImportsDir(join(here, 'reports'));
    // Only where the configuration names no `#reports` of its own.
    nuxt.options.alias['#reports'] ||= join(here, 'reports');
  },
});
