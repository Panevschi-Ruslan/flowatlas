import { catalogBase, ordersBase, ordersV1, urls } from '../lib/api';
import { isProd } from '../lib/env';

/** A condition written in place, over two settings nobody settles. */
export async function openOrders() {
  const res = await fetch(`${isProd ? process.env.ORDERS_URL : process.env.ORDERS_DEV_URL}/orders/open`);
  return res.json();
}

/** The same condition, through the helper. */
export async function allOrders() {
  const res = await fetch(`${ordersBase()}/orders`);
  return res.json();
}

/** The helper's returns, each with the path written after its setting. */
export async function lateOrders() {
  const res = await fetch(`${ordersV1()}/late`);
  return res.json();
}

/** A function handed nothing, read as the setting it returns. */
export async function items() {
  const res = await fetch(`${catalogBase()}/items`);
  return res.json();
}

/** A function an object holds, its parameter at its default. */
export async function categories() {
  const res = await fetch(`${urls.catalog()}/categories`);
  return res.json();
}
