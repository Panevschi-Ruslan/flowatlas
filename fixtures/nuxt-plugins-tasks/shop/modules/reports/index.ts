import { addPlugin, addServerHandler, addServerPlugin, addServerScanDir, createResolver, defineNuxtModule } from '@nuxt/kit';

export default defineNuxtModule({
  meta: { name: 'reports' },
  setup(_options, nuxt) {
    const resolver = createResolver(import.meta.url);
    // Its routes, plugins and tasks, read as `server/` is.
    addServerScanDir(resolver.resolve('./runtime/server'));
    // A plugin of the application, which adds a route middleware.
    addPlugin(resolver.resolve('./runtime/plugin'));
    // A plugin of the server.
    addServerPlugin(resolver.resolve('./runtime/nitro/timing'));
    // Only the development server serves it: production is read.
    if (nuxt.options.dev) {
      addServerHandler({ route: '/api/reports/debug', handler: resolver.resolve('./runtime/debug') });
    }
  },
});
