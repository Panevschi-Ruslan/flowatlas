/** Whether this is a production run: decided where the code runs, never written. */
const isProd = process.env.NODE_ENV === 'production';

/** The first of two settings that is set; different services claim them. */
const ordersBase = process.env.ORDERS_URL || process.env.LEGACY_URL;

/** The first setting's service serves it: joined there, as sure as before. */
export const openOrders = () => fetch(`${ordersBase}/orders/open`).then((res) => res.json());

/** Only legacy, behind the second setting, serves it: joined to legacy, not reported missing from orders. */
export const archivedOrders = () => fetch(`${ordersBase}/archive`).then((res) => res.json());

/** Both services claiming the second setting serve it: a row naming each. */
export const ordersStatus = () => fetch(`${ordersBase}/status`).then((res) => res.json());

/** Nobody serves it: the first setting's service lacks it, as before. */
export const ordersNowhere = () => fetch(`${ordersBase}/nowhere`).then((res) => res.json());

/** One of two settings by a condition nobody settles; the second is claimed by legacy and archive alike. */
const exportBase = () => (isProd ? process.env.ORDERS_URL : process.env.LEGACY_URL);

/** Only archive serves it: joined there, as a guess. */
export const exportsList = () => fetch(`${exportBase()}/exports`).then((res) => res.json());

/** The shop's own route at 3000, where the API only falls back to. */
export const cart = () => fetch('http://localhost:3000/api/cart').then((res) => res.json());

/** The API's route at its fallback port. */
export const items = () => fetch('http://localhost:3000/items').then((res) => res.json());

/** Served by nobody at 3000: the written fallback outranks the framework's default. */
export const stray = () => fetch('http://localhost:3000/stray').then((res) => res.json());
