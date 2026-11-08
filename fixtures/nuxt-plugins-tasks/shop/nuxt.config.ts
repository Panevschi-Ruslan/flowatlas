export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  nitro: {
    experimental: { tasks: true },
    // Each expression runs the tasks it lists; the second names one no file gives.
    scheduledTasks: {
      '0 * * * *': ['orders:expire'],
      '0 3 * * *': ['db:backup', 'reports:daily'],
    },
  },
});
