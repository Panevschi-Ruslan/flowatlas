import axios from 'axios';

/** Every order request goes through this one instance, at the orders service's base. */
export const ordersApi = axios.create({ baseURL: import.meta.env.VITE_ORDERS_URL, timeout: 5000 });
