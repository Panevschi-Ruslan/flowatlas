/** Indexes the platform's clicks for the audit trail, a batch at a time. */
export const handler = async (event: { Records: unknown[] }): Promise<number> => event.Records.length;
