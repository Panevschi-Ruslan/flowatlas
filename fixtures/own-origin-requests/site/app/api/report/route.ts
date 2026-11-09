/** A report the site's server builds by asking its own route, with no host: on the server this throws. */
export async function GET(): Promise<Response> {
  const orders = await fetch('/api/orders');
  return Response.json({ count: (await orders.json()).length });
}
