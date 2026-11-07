import axios from 'axios';

import { basketApi, stockApi } from './api';

/** A local dashboard that names each service by the port it runs on. */
export const Dashboard = () => {
  const loadOrders = () => fetch('http://localhost:3001/orders');
  const ordersHealth = () => fetch('http://localhost:3001/health');
  const loadProducts = () => axios.get('http://127.0.0.1:3003/products');
  const loadEntries = () => fetch('http://localhost:3005/entries');
  const loadReports = () => fetch('http://localhost:3020/api/reports');
  const loadStock = () => stockApi.get('ABC-1');
  const loadBasket = () => basketApi.get('basket');
  return (
    <section>
      <button onClick={loadOrders}>Orders</button>
      <button onClick={ordersHealth}>Orders health</button>
      <button onClick={loadProducts}>Products</button>
      <button onClick={loadEntries}>Entries</button>
      <button onClick={loadReports}>Reports</button>
      <button onClick={loadStock}>Stock</button>
      <button onClick={loadBasket}>Basket</button>
    </section>
  );
};
