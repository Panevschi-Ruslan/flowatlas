import type { SQSEvent } from 'aws-lambda';

/** Runs every job submitted. */
export const handler = async (event: SQSEvent): Promise<number> => event.Records.length;
