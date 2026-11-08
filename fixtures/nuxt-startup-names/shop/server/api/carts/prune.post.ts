export default defineEventHandler(async () => {
  // Runs the task by its name; with the flag off the build has no task of that name.
  return runTask('carts:prune');
});
