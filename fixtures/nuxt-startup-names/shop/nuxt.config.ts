export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  extends: ['../brand'],
  modules: ['@nuxt/ui'],
  // `nitro.experimental.tasks` is not set: Nitro 2 builds no task.
  nitro: {
    scheduledTasks: { '0 4 * * *': ['carts:prune'] },
  },
});
