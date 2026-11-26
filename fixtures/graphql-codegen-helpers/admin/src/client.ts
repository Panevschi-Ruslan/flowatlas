import { createClient } from 'urql';

export const adminClient = createClient({ url: `${import.meta.env.VITE_API_URL}/settings`, exchanges: [] });
