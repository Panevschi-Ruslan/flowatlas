export default defineEventHandler(async () => {
  // Runs the task by its name, as its schedule does.
  return runTask('orders:expire', { payload: { olderThan: 7 } });
});
