import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5190,
    proxy: {
      '/shop': { target: 'http://localhost:5180', rewrite: (path) => path.replace(/^\/shop/, '') },
      '/loop': 'http://localhost:5180',
    },
  },
});
