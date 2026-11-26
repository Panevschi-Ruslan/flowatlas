import axios from 'axios';

/** One instance for the whole front end; which API a request goes to is read off its own address. */
export const http = axios.create();

http.interceptors.request.use((config) => {
  config.baseURL = config.url.startsWith('/admin') ? '/office-rest' : '/store-rest';
  return config;
});
