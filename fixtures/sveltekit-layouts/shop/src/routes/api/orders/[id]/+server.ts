import { json } from '@sveltejs/kit';

export const GET = async ({ params }: { params: { id: string } }): Promise<Response> => json({ id: params.id });
