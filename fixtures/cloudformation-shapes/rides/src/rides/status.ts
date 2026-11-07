/** Every request to the status API, made in one resource. */
export const handler = async (event: unknown): Promise<unknown> => {
  return { ok: true, event };
};
