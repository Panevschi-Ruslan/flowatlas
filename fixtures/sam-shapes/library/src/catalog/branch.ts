/** GET /branches/{branchId}: one branch of the library. */
export const handler = async (event: unknown): Promise<unknown> => {
  return { ok: true, event };
};
