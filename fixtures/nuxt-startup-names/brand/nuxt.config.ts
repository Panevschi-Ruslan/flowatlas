export default defineNuxtConfig({
  // A library of components installed by its Nuxt module, named by the layer alone.
  modules: ['@primevue/nuxt-module'],
  // Its components under a prefix of the application's: <PrimeButton>, <PrimeDataTable>.
  primevue: {
    components: { prefix: 'Prime' },
  },
});
