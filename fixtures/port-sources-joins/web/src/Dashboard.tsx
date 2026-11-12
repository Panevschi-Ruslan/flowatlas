/** A local dashboard that names each service by the port it is run on. */
export const Dashboard = () => {
  const loadOrders = () => fetch('http://localhost:3001/orders');
  const loadStock = () => fetch('http://localhost:3002/stock/ABC-1');
  const loadProducts = () => fetch('http://localhost:3003/products');
  const loadInvoices = () => fetch('http://localhost:3004/invoices');
  const loadEntries = () => fetch('http://localhost:3005/entries');
  const loadEvents = () => fetch('http://localhost:3006/events');
  const loadSearch = () => fetch('http://localhost:4007/search');
  const loadNotices = () => fetch('http://localhost:3008/notices');
  const loadBasket = () => fetch('http://localhost:5174/api/basket');
  const runJob = () => fetch('http://localhost:3009/jobs/run', { method: 'POST' });
  const proxied = () => fetch('http://localhost:5173/products');
  return (
    <section>
      <button onClick={loadOrders}>Orders</button>
      <button onClick={loadStock}>Stock</button>
      <button onClick={loadProducts}>Products</button>
      <button onClick={loadInvoices}>Invoices</button>
      <button onClick={loadEntries}>Entries</button>
      <button onClick={loadEvents}>Events</button>
      <button onClick={loadSearch}>Search</button>
      <button onClick={loadNotices}>Notices</button>
      <button onClick={loadBasket}>Basket</button>
      <button onClick={runJob}>Run job</button>
      <button onClick={proxied}>Products through the dev server</button>
    </section>
  );
};
