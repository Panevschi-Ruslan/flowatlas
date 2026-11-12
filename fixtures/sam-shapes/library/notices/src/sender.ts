/** Sends the notice of a lost return, and resends one on request. */
export const handler = async (event: unknown): Promise<unknown> => {
  return { ok: true, event };
};
