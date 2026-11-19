/** The cms's health, a route its register hook adds to the content API. */
export const health = () => fetch('http://localhost:4510/api/health').then((res) => res.json());

/** The cms's ping, on Strapi's own router. */
export const ping = () => fetch('http://localhost:4510/ping').then((res) => res.text());

/** The installed ratings plugin's routes: one its package answers, one the application's extension does. */
export const ratings = () => fetch('http://localhost:4510/api/ratings/ratings').then((res) => res.json());
export const rate = (body: unknown) => fetch('http://localhost:4510/api/ratings/ratings', { method: 'POST', body: JSON.stringify(body) }).then((res) => res.json());

/** The reviews plugin's own route, and the one an extension pushes into its router. */
export const latest = () => fetch('http://localhost:4510/api/reviews/latest').then((res) => res.json());
export const top = () => fetch('http://localhost:4510/api/reviews/top').then((res) => res.json());

/** The site's functions: a plugin listed by its path, and an installed one. */
export const send = () => fetch('http://localhost:8300/api/contact/send', { method: 'POST' }).then((res) => res.json());
export const submit = () => fetch('http://localhost:8300/api/gatsby-plugin-forms/submit', { method: 'POST' }).then((res) => res.json());

/** The gateway, on the port its --config package gives; the edge, on its TypeScript --config file's. */
export const status = () => fetch('http://localhost:4520/api/status').then((res) => res.json());
export const edge = () => fetch('http://localhost:4530/api/edge').then((res) => res.json());

/** The api, on the port its deployment writes over its settings. */
export const apiHealth = () => fetch('http://localhost:4540/health').then((res) => res.json());

/** The workers, on the port of the server handed down to the one that starts it. */
export const work = () => fetch('http://localhost:4550/api/work').then((res) => res.json());
