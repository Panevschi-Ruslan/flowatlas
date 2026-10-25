import type { SQSEvent } from 'aws-lambda';

/** Reads the thumbnails queue, which the uploads bucket fills with what is created under `thumbnails/`. */
export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) console.log('indexed', record.messageId);
};
