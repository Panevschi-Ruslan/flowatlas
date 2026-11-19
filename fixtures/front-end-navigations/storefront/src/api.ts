import axios from 'axios';

/** The storefront's client: every request it makes carries the headers written to its defaults. */
export const api = axios.create({ baseURL: '/api' });

api.defaults.headers.common['X-Storefront'] = 'web';
api.defaults.headers['X-Locale'] = 'en';

/** Set once a visitor signs in: under a condition, so which requests carry it is not read. */
export function signedIn(token: string | undefined): void {
  if (token !== undefined) api.defaults.headers.common.Authorization = `Bearer ${token}`;
}
