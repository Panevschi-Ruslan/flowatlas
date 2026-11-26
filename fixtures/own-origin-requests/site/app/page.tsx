/** The home page asks for the orders; the browser reads this file too. */
export default async function Page() {
  const orders = await fetch('/api/orders');
  return <main>{String(orders.ok)}</main>;
}
