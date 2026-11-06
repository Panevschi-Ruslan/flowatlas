import axios from 'axios';

import { isStaff } from '../config';

/**
 * The honest case: the interceptor picks one of two bases by a branch, so
 * which service a request goes to is decided at run time.
 */
export const legacyApi = axios.create();

legacyApi.interceptors.request.use((config) => ({
  ...config,
  baseURL: isStaff() ? import.meta.env.VITE_ORDERS_URL : import.meta.env.VITE_BILLING_URL,
}));
