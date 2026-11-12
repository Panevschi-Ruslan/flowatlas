import adapter from '@sveltejs/adapter-auto';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter(),
    files: {
      // The routes and the pages are in `src/app`, not `src/routes`.
      routes: 'src/app',
    },
  },
};

export default config;
