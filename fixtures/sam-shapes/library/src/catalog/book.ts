/** GET /books/{isbn}: one book of the catalogue. */
export const handler = async (event: unknown): Promise<unknown> => {
  return { ok: true, event };
};
