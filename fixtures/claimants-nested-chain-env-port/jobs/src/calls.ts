/** Whether this is a production run: decided where the code runs, never written. */
const isProd = process.env.NODE_ENV === 'production';

/** A setting two services claim. */
const ordersBase = process.env.ORDERS_URL;

/** Only legacy serves it: joined there, as a guess naming both claims. */
export const legacyOrders = () => fetch(`${ordersBase}/v1/orders`).then((res) => res.json());

/** Both claimants serve it: a row naming each. */
export const ordersStatus = () => fetch(`${ordersBase}/status`).then((res) => res.json());

/** Nobody serves it: the row naming the claimants, as before. */
export const ordersNowhere = () => fetch(`${ordersBase}/nowhere`).then((res) => res.json());

/** A condition nobody settles, and a chain read after it where neither branch's setting is set. */
const shelfBase = () => (isProd ? process.env.CATALOG_URL : process.env.STOCK_URL) || process.env.ARCHIVE_URL;

/** A branch's service serves it: joined there, as a guess. */
export const products = () => fetch(`${shelfBase()}/products`).then((res) => res.json());

/** Only the service of the setting read after the condition serves it: joined there, as a guess. */
export const exportsList = () => fetch(`${shelfBase()}/exports`).then((res) => res.json());

/** The API where its development environment file places it. */
export const items = () => fetch('http://localhost:4000/items').then((res) => res.json());

/** The API's fallback port, where no run with the file listens. */
export const itemsAtFallback = () => fetch('http://localhost:3000/items').then((res) => res.json());

/** The port the audit service listens on, which the reports service only falls back to. */
export const auditLog = () => fetch('http://localhost:3100/audit/log').then((res) => res.json());
