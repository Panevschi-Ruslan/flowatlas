import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  return {
    plugins: [react()],
    server: {
      port: 5180,
      proxy: {
        '/api': { target: env.VITE_GATEWAY_URL, rewrite: (path) => path.replace(/^\/api/, '') },
        '^/legacy/.*': { target: 'http://localhost:3003', rewrite: (path) => path.replace(/^\/legacy/, '') },
        '/v2': { target: 'http://localhost:3003', rewrite: (path) => path.replace(/^\/v2\/catalog/, '') },
        '/loop': 'http://localhost:5190',
      },
    },
  };
});
