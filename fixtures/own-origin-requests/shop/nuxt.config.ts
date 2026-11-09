export default defineNuxtConfig({
  routeRules: {
    '/catalog/**': { proxy: 'http://localhost:3003/**' },
  },
});
