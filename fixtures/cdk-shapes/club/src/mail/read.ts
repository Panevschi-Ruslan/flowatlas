import type { SQSEvent } from 'aws-lambda';

/** Reads the inbox. */
export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) console.log('read', record.body);
};
