export const handler = async (event: { body: string }) => {
  const booking = JSON.parse(event.body) as { slot: string; name: string };
  return { statusCode: 201, body: JSON.stringify({ id: `${booking.slot}-${booking.name}` }) };
};
