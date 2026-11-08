import { json } from '@sveltejs/kit';

export const GET = async (): Promise<Response> => json({ user: 'someone' });

export const DELETE = async (): Promise<Response> => new Response(null, { status: 204 });
