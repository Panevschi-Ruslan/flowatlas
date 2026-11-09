/** The answer to a query of a shop's own records, or nothing when the request asks for none. */
export const answerFromRecords = async (request: Request): Promise<Response | undefined> => {
  const body = (await request.clone().json()) as { query?: string };
  if (body.query === undefined || !body.query.includes('products')) return undefined;
  return new Response(JSON.stringify({ data: { products: [] } }), { headers: { 'content-type': 'application/json' } });
};
