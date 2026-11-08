/** Tallies the platform's clicks, a batch of records at a time. */
export const handler = async (event: { Records: unknown[] }): Promise<number> => event.Records.length;
