import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Several tests read the multi-repo fixture graph, which is generated and
    // therefore not committed. Build it once if the checkout has none.
    globalSetup: ['../../scripts/fixture-graph.mjs'],
  },
});
