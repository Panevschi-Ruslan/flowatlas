/** The shop, calling its own dev server, which forwards each prefix to a service. */
export const Shop = () => {
  const loadOrders = () => fetch('/api/orders');
  const loadOrder = (id: string) => fetch(`/api/orders/${id}`);
  const loadProducts = () => fetch('/products');
  const loadRates = () => fetch('/rates/today');
  const loadMissing = () => fetch('/api/returns');
  const loadDirect = () => fetch('http://localhost:5180/api/orders');
  return (
    <section>
      <button onClick={loadOrders}>Orders</button>
      <button onClick={() => loadOrder('7')}>Order</button>
      <button onClick={loadProducts}>Products</button>
      <button onClick={loadRates}>Rates</button>
      <button onClick={loadMissing}>Returns</button>
      <button onClick={loadDirect}>Orders through the dev server</button>
    </section>
  );
};
