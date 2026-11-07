/** GET /maps/{zone}: the docks of a zone, from an API whose body is a file of its own. */
export const handler = async (event: unknown): Promise<unknown> => {
  return { ok: true, event };
};
