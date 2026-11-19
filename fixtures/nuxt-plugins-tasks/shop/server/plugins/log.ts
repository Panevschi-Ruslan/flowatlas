export default defineNitroPlugin((nitroApp) => {
  // In front of every route.
  nitroApp.hooks.hook('request', (event) => {
    event.context.startedAt = Date.now();
  });
  // Behind every route.
  nitroApp.hooks.hook('afterResponse', (event) => {
    event.context.finishedAt = Date.now();
  });
  // Not a step of a request.
  nitroApp.hooks.hook('close', () => undefined);
});
