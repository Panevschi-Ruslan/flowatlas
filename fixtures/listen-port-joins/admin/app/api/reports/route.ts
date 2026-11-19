/** The admin's own route, served by `next dev -p 3020`. */
export async function GET(): Promise<Response> {
  return Response.json([]);
}
