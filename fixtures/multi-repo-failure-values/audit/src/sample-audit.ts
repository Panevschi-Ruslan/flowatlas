/** Samples the platform's clicks from the start of the stream. */
export const handler = async (event: { Records: unknown[] }): Promise<number> => event.Records.length;
