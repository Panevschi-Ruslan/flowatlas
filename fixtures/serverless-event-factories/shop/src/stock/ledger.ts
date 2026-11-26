export const handler = async (event: { body: string }) => {
  const entry = JSON.parse(event.body) as { orderId: string; items: string[] };
  return { statusCode: 200, body: JSON.stringify({ recorded: entry.items.length }) };
};
