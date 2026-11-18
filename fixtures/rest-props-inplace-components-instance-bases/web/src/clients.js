import axios from 'axios';

// One client per service, each at its own port.
export const catalogApi = axios.create({ baseURL: 'http://localhost:4600' });
export const stockApi = axios.create({ baseURL: 'http://localhost:4700' });
