/** The gateway renders on its server, asking its own address for its health and for an order. */
export default async function Page() {
  const health = await fetch('/api/health');
  const order = await fetch('/orders/today');
  return (
    <main>
      {String(health.ok)} {String(order.ok)}
    </main>
  );
}
