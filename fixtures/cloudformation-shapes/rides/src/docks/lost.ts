/** Reports a lost bike, from a topic another repository exports. */
export const handler = async (event: unknown): Promise<unknown> => {
  return { ok: true, event };
};
