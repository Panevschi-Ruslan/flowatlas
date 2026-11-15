import { isProd } from './env';

/** The orders API: one setting in production, another in development. */
export const ordersBase = () => (isProd ? process.env.ORDERS_URL : process.env.ORDERS_DEV_URL);

/** The same choice as returns of a function, with a path written after each. */
export function ordersV1(): string {
  if (isProd) return `${process.env.ORDERS_URL}/orders`;
  return `${process.env.ORDERS_DEV_URL}/orders`;
}

/** The catalog API, read inside a function handed nothing. */
export function catalogBase() {
  return process.env.CATALOG_URL ?? 'http://localhost:4600';
}

/** A function an object holds, handed nothing, with a parameter it leaves at its default. */
export const urls = {
  catalog: (section = '') => (section ? `${process.env.CATALOG_URL}/${section}` : process.env.CATALOG_URL),
};
