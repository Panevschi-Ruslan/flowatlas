import axios from 'axios';

/**
 * The orders client. Made with no base; the interceptor below gives every
 * request one, after the call's own options are merged in.
 */
export const ordersApi = axios.create({ timeout: 5000 });

ordersApi.interceptors.request.use((config) => {
  config.baseURL = import.meta.env.VITE_ORDERS_URL;
  config.headers = { ...config.headers, 'x-client': 'shop' };
  return config;
});
