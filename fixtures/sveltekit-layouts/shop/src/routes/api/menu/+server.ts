import { json } from '@sveltejs/kit';

export const GET = async (): Promise<Response> => json([{ name: 'Orders' }]);
