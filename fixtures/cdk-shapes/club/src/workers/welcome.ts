import type { SQSEvent } from 'aws-lambda';

/** Reads the welcome queue. */
export const handler = async (event: SQSEvent): Promise<void> => {
  console.log('welcome', event.Records.length);
};
