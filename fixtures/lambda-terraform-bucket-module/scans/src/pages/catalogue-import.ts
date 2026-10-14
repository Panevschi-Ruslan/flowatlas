import type { SQSEvent } from 'aws-lambda';

/** Reads the queue of batches imported in parts, and catalogues each. */
export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) console.log(`cataloguing ${record.messageId}`);
};
