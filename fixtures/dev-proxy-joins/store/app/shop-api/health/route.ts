/** The store's own route, which Next serves before its rewrites. */
export async function GET(): Promise<Response> {
  return Response.json({ ok: true });
}
