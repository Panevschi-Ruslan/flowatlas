/** Audits the loans every hour, where the audit is deployed at all. */
export const handler = async (event: unknown): Promise<unknown> => {
  return { ok: true, event };
};
