/**
 * The same address the application at the root answers, which is the collision
 * this fixture exists for: the two are never deployed together, so they are two
 * declarations and not two claims on one address.
 */
export async function GET(): Promise<Response> {
  return Response.json([]);
}
