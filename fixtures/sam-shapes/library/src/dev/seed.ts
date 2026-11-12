/** Seeds a development stack with books; never deployed to prod. */
export const handler = async (event: unknown): Promise<unknown> => {
  return { ok: true, event };
};
