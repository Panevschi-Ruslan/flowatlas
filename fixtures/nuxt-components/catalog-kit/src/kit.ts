import { addComponentsDir, addRouteMiddleware, addServerHandler, addServerScanDir, createResolver, defineNuxtModule } from '@nuxt/kit';

export default defineNuxtModule({
  meta: { name: 'catalog-kit', configKey: 'catalog' },
  defaults: { search: false },
  setup(options) {
    const resolver = createResolver(import.meta.url);
    // Components the application's templates use by name.
    addComponentsDir({ path: resolver.resolve('./runtime/components') });
    // A route middleware a page names.
    addRouteMiddleware({ name: 'catalog-guard', path: resolver.resolve('./runtime/guard') });
    // A server directory of its own, read as `server/` is.
    addServerScanDir(resolver.resolve('./runtime/server'));
    // Turned on by `catalog.search` in the configuration.
    if (options.search) {
      addServerHandler({ route: '/api/search', handler: resolver.resolve('./runtime/search') });
    }
  },
});
