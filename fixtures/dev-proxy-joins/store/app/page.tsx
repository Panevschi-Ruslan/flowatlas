'use client';

/** The store front, asking orders through its own rewrite, and its own route directly. */
export default function Page() {
  const loadOrders = () => fetch('/shop-api/orders');
  const loadHealth = () => fetch('/shop-api/health');
  return (
    <main>
      <button onClick={loadOrders}>Orders</button>
      <button onClick={loadHealth}>Health</button>
    </main>
  );
}
