/** The application's own cart. */
export async function loader() {
  return Response.json({ lines: [] });
}
