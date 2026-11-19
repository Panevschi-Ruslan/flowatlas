export async function POST(request: Request): Promise<Response> {
  return Response.json({ user: await request.json() });
}
