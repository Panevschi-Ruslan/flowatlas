/** The body of the API's one route, one package away from it. */
export const sendReceipt = async (to: string, orderId: string): Promise<void> => {
  await fetch(`${process.env.MAIL_RELAY_URL}/send`, {
    method: 'POST',
    body: JSON.stringify({ to, subject: `Receipt for ${orderId}` }),
  });
};
