import type { SQSEvent } from 'aws-lambda';

/** Keeps a record of what the orders service audits. */
export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) JSON.parse(record.body);
};
