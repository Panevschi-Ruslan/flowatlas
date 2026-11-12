// The server is built by Vite, and `@lib` is declared here alone: the
// tsconfig names no paths.
export default {
  resolve: {
    alias: {
      '@lib': './src/lib',
    },
  },
};
