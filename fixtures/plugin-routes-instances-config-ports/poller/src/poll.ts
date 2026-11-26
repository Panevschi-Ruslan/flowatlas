/** The reviews plugin's summary, on the content API, as the staging build listens. */
export const summary = () => fetch('http://localhost:4411/api/reviews/summary').then((res) => res.json());

/** The reviews plugin's settings, on the admin API, under the plugin's name. */
export const saveSettings = (body: unknown) =>
  fetch('http://localhost:4411/reviews/settings', { method: 'PUT', body: JSON.stringify(body) }).then((res) => res.json());

/** The signed-in user's orders, a route behind a policy and a middleware. */
export const orders = () => fetch('http://localhost:4411/api/orders/mine').then((res) => res.json());

/** The newsletter plugin's function, as the development server serves it. */
export const subscribe = () => fetch('http://localhost:8200/api/newsletter/subscribe', { method: 'POST' }).then((res) => res.json());

/** The site's own function, under the path prefix gatsby serve adds. */
export const hello = () => fetch('http://localhost:9200/blog/api/hello').then((res) => res.json());

/** The gateway, on the port its --config file gives. */
export const status = () => fetch('http://localhost:4420/api/status').then((res) => res.json());

/** The api, on the port laid over its settings at start. */
export const health = () => fetch('http://localhost:4430/health').then((res) => res.json());

/** The workers, on the port of the server the supervisor runs. */
export const work = () => fetch('http://localhost:4440/api/work').then((res) => res.json());
