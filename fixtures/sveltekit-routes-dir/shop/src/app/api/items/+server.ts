import { json } from '@sveltejs/kit';

export const GET = async (): Promise<Response> => json([{ id: '1', name: 'first' }]);
