/** Orders as `make orders`, `make orders-dev` and `make orders-staging` start it. */
export const orders = () => fetch('http://localhost:4300/orders').then((res) => res.json());
export const devOrders = () => fetch('http://localhost:4310/orders').then((res) => res.json());
export const stagingOrders = () => fetch('http://localhost:4330/orders').then((res) => res.json());

/** Billing, in each branch of the conditional on CI. */
export const ciInvoices = () => fetch('http://localhost:4350/invoices').then((res) => res.json());
export const invoices = () => fetch('http://localhost:4351/invoices').then((res) => res.json());

/** The catalog, in the mode compose interpolates from the project's .env. */
export const products = () => fetch('http://localhost:4402/api/products').then((res) => res.json());

/** Search, in the mode Bun takes with none given. */
export const search = () => fetch('http://localhost:4501/api/search').then((res) => res.json());

/** Pricing, in the mode its env_file gives. */
export const prices = () => fetch('http://localhost:4602/api/prices').then((res) => res.json());

/** Tickets and alerts, Bun run as node. */
export const tickets = () => fetch('http://localhost:4702/api/tickets').then((res) => res.json());
export const alerts = () => fetch('http://localhost:4802/api/alerts').then((res) => res.json());

/** Notices, read as Node in an image of Bun's. */
export const notices = () => fetch('http://localhost:4901/api/notices').then((res) => res.json());

/** Inventory, listening through its package. */
export const stock = () => fetch('http://localhost:4950/stock').then((res) => res.json());
