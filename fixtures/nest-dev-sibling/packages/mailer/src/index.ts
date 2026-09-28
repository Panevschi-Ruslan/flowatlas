/**
 * The body of the API's one route, one package away from it.
 *
 * It reads a setting and makes a request, which is what says the file was
 * walked as part of the service rather than merely pointed at.
 */
export const sendReceipt = async (to: string, orderId: string): Promise<void> => {
  const relay = process.env.MAIL_RELAY_URL;
  await fetch(`${relay}/send`, {
    method: 'POST',
    body: JSON.stringify({ to, subject: `Receipt for ${orderId}` }),
  });
};
