export const DELETE = async ({ params }: { params: { id: string } }): Promise<Response> =>
  new Response(null, { status: 204, headers: { 'x-removed': params.id } });
