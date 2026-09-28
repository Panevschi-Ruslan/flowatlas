/** The root application's orders, at the address the framework serves it at. */
export async function GET(): Promise<Response> {
  return Response.json([]);
}
