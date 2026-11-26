/** Opens the door, and welcomes a member who signs up: the kiosk and the catalogue are asked through their URLs. */
export const handler = async (event: { memberId?: string }): Promise<{ open: boolean }> => {
  const kiosk = await fetch(process.env.KIOSK_URL + '/members', { method: 'POST', body: JSON.stringify(event) });
  const book = await fetch(process.env.BOOK_URL + '/recommended');
  return { open: kiosk.ok && book.ok };
};
