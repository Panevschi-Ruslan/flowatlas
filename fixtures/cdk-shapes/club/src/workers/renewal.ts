import type { SQSEvent } from 'aws-lambda';

/** Reads the renewal queue. */
export const handler = async (event: SQSEvent): Promise<void> => {
  console.log('renewal', event.Records.length);
};
