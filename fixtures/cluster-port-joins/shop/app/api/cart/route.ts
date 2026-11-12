/** The shop's own route, served by the workspace tool's target on 4300. */
export async function GET(): Promise<Response> {
  return Response.json({ items: [] });
}
