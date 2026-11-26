/** Adds a route to an installed plugin's router. */
export default (plugin) => {
  plugin.routes['content-api'].routes.push({ method: 'GET', path: '/accounts/session', handler: 'session.show' });
  return plugin;
};
