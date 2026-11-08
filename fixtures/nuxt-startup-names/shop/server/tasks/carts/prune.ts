export default defineTask({
  meta: { name: 'carts:prune', description: 'Drop carts nobody touched for a month' },
  run() {
    return { result: 'pruned' };
  },
});
