'use client';

import { isProd } from '../lib/env';

const ordersBase = () => (isProd ? process.env.NEXT_PUBLIC_ORDERS_URL : process.env.NEXT_PUBLIC_ORDERS_DEV_URL);

function catalogBase() {
  return process.env.NEXT_PUBLIC_CATALOG_URL ?? 'http://localhost:4600';
}

/** The browser's half: the same shapes under the public settings. */
export function Orders() {
  const load = async () => {
    await fetch(`${ordersBase()}/orders`);
    await fetch(`${catalogBase()}/items`);
  };
  return <button onClick={load}>Load</button>;
}
