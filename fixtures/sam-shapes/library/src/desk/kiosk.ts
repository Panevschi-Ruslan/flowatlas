/** The self-service kiosk, reached at its own URL and every night. */
export const handler = async (event: unknown): Promise<unknown> => {
  return { ok: true, event };
};
