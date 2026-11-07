/** The kiosk at a dock, reached at its own address. */
export const handler = async (event: unknown): Promise<unknown> => {
  return { ok: true, event };
};
