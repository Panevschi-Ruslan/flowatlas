/**
 * An address only the root application spells out.
 *
 * The other application answers `/api/posts` with a catch-all, and the caller
 * inside it means that catch-all — not this, which belongs to a program it is
 * never deployed with.
 */
export async function GET(): Promise<Response> {
  return Response.json([]);
}
