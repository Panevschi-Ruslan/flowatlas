import axios from 'axios';

/** Every request the application makes goes through this one client. */
export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL });
