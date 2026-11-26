/** The store's cart. */
export async function loader() {
  return Response.json({ lines: [] });
}
