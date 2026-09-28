/**
 * The whole of a third application's `/api`: one catch-all and nothing spelled
 * out, which is how a template that is only there to be copied usually reads.
 */
export async function GET(): Promise<Response> {
  return Response.json([]);
}
