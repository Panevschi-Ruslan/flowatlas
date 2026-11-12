/** An order placed through the API, or handed over by the router. */
export const place = async (event: { body?: string; id?: string }) => {
  const order = event.body === undefined ? { id: event.id } : (JSON.parse(event.body) as { id: string });
  return { statusCode: 201, body: JSON.stringify(order) };
};
