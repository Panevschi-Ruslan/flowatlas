/** Whether this is a production run: decided where the code runs, never written. */
const isProd = process.env.NODE_ENV === 'production';

/** One of two settings, which different services claim. */
const ordersBase = () => (isProd ? process.env.ORDERS_URL : process.env.LEGACY_URL);

/** Only orders serves it: joined there, as a guess. */
export const openOrders = () => fetch(`${ordersBase()}/orders/open`).then((res) => res.json());

/** Only legacy serves it: joined to legacy, not reported missing from orders. */
export const archivedOrders = () => fetch(`${ordersBase()}/archive`).then((res) => res.json());

/** Both serve it: a row naming each. */
export const ordersHealth = () => fetch(`${ordersBase()}/health`).then((res) => res.json());

/** Neither serves it: the first branch's service lacks it, as before. */
export const ordersNowhere = () => fetch(`${ordersBase()}/nowhere`).then((res) => res.json());

/** The shop's own route at 3000, which the API's example file only offers. */
export const cart = () => fetch('http://localhost:3000/api/cart').then((res) => res.json());

/** The API's route at the port its example file offers. */
export const items = () => fetch('http://localhost:3000/items').then((res) => res.json());

/** Served by nobody at 3000: the offered port outranks the default, as a merged port does. */
export const stray = () => fetch('http://localhost:3000/stray').then((res) => res.json());
