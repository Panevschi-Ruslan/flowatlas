/** The shop's cart, served by its own application on the port Next assumes. */
export async function GET() {
  return Response.json({ items: [] });
}
