/** Called from the API's request handler, after the receipt is rendered. */
export const relay = async (to: string, html: string): Promise<void> => {
  await fetch(`${process.env.MAIL_RELAY_URL}/send`, {
    method: 'POST',
    body: JSON.stringify({ to, html }),
  });
};
