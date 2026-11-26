import axios from 'axios';

/**
 * Calls on `axios` itself go to billing: the address is rewritten under the
 * setting. An instance has interceptors of its own, so none of this reaches
 * `ordersApi` or `legacyApi`.
 */
axios.interceptors.request.use((config) => {
  if (!config.url?.startsWith('http')) config.url = import.meta.env.VITE_BILLING_URL + config.url;
  return config;
});
