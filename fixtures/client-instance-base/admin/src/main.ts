import { api } from './api/client';

// Set once, after the instance is made, before any screen sends anything.
api.defaults.baseURL = import.meta.env.VITE_ORDERS_URL;
