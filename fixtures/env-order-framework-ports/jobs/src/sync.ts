/** The catalog, on the port its bootstrap is handed over the defaults it loads. */
export const items = () => fetch('http://localhost:4100/api/items').then((res) => res.json());

/** Search, on the port its settings' instance is loaded with. */
export const search = () => fetch('http://localhost:4200/api/search').then((res) => res.json());

/** Orders, on the port of the later --env-file. */
export const orders = () => fetch('http://localhost:4300/api/orders').then((res) => res.json());

/** Billing, on the port of the file Bun loads for production. */
export const invoices = () => fetch('http://localhost:4400/api/invoices').then((res) => res.json());

/** Inventory, on the port its example environment file offers, a guess. */
export const stock = () => fetch('http://localhost:4500/api/stock').then((res) => res.json());

/** The gateway fastify-cli starts, on the port its .env gives FASTIFY_PORT. */
export const health = () => fetch('http://localhost:4600/api/health').then((res) => res.json());

/** The worker, on the port from before the write a library answers, a guess. */
export const tasks = () => fetch('http://localhost:3800/api/tasks').then((res) => res.json());
