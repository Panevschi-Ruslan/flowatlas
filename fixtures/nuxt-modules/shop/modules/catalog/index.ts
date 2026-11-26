import { addComponentsDir, addImportsDir, addRouteMiddleware, addServerHandler, createResolver, defineNuxtModule, extendPages } from '@nuxt/kit';

export default defineNuxtModule({
  meta: { name: 'catalog' },
  setup(_options, nuxt) {
    const resolver = createResolver(import.meta.url);
    // Names the application's pages call with no import.
    addImportsDir(resolver.resolve('./runtime/composables'));
    // A route no file of `server/` gives.
    addServerHandler({ route: '/api/catalog', method: 'get', handler: resolver.resolve('./runtime/server/catalog') });
    // A page no directory of pages gives.
    extendPages((pages) => {
      pages.push({ name: 'catalog', path: '/catalog', file: resolver.resolve('./runtime/pages/catalog.vue') });
    });
    nuxt.options.alias['#catalog'] = resolver.resolve('./runtime');
    // Said in the note, not drawn.
    addComponentsDir({ path: resolver.resolve('./runtime/components') });
    addRouteMiddleware({ name: 'catalog-guard', path: resolver.resolve('./runtime/middleware/guard'), global: true });
  },
});
