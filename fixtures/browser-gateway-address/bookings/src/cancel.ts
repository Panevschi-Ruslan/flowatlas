export const handler = async (event: { pathParameters?: { id?: string } }) => ({
  statusCode: 204,
  body: JSON.stringify({ cancelled: event.pathParameters?.id ?? null }),
});
