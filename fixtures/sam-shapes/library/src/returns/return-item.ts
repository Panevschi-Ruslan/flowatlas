/** Takes a returned book off the returns stream. */
export const handler = async (event: unknown): Promise<unknown> => {
  return { ok: true, event };
};
