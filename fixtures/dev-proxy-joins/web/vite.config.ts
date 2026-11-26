import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/products': 'http://localhost:3003',
      '/rates': 'https://rates.example.test',
      '^/legacy/.*': 'http://localhost:3009',
      '/stats': { target: process.env.STATS_URL },
    },
  },
});
