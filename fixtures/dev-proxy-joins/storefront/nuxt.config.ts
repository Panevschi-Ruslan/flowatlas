export default defineNuxtConfig({
  routeRules: {
    '/orders-api/**': { proxy: 'http://localhost:3001/**' },
  },
  nitro: {
    devProxy: {
      '/catalog': { target: 'http://localhost:3003', changeOrigin: true },
    },
  },
});
