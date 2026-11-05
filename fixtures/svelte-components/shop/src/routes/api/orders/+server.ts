import { json } from '@sveltejs/kit';

export const POST = async ({ request }: { request: Request }): Promise<Response> => {
  const body = (await request.json()) as { name: string };
  return json({ id: '1', name: body.name }, { status: 201 });
};
