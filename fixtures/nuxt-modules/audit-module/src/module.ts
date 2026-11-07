import { addImports, addServerHandler, createResolver, defineNuxtModule } from '@nuxt/kit';

export default defineNuxtModule({
  meta: { name: 'audit-module' },
  setup() {
    const { resolve } = createResolver(import.meta.url);
    // One name, from one file.
    addImports({ name: 'useAudit', from: resolve('./runtime/useAudit') });
    addServerHandler({ route: '/api/audit', method: 'post', handler: resolve('./runtime/server/audit.post') });
  },
});
