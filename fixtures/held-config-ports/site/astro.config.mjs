import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  integrations: [react()],
  server: ({ command }) => ({ port: command === 'dev' ? 4400 : 4401 }),
});
