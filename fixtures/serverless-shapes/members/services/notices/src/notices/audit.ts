import type { SQSEvent } from 'aws-lambda';

/** Reads the club's shared audit queue, which another stack exports. */
export const handler = async (event: SQSEvent): Promise<void> => {
  console.log('audited', event.Records.length);
};
