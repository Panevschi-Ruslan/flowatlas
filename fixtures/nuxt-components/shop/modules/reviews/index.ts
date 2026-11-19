import { addServerHandler, createResolver, defineNuxtModule } from '@nuxt/kit';

export default defineNuxtModule({
  meta: { name: 'reviews', configKey: 'reviews' },
  defaults: { enabled: true },
  setup(options) {
    // The configuration hands this module `enabled: false`: nothing below is added.
    if (!options.enabled) return;
    const resolver = createResolver(import.meta.url);
    addServerHandler({ route: '/api/reviews', handler: resolver.resolve('./runtime/reviews') });
  },
});
