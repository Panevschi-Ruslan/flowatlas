/** Shelves the fiction returned, from its own queue. */
export const handler = async (event: unknown): Promise<unknown> => {
  return { ok: true, event };
};
