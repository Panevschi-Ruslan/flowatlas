import type { SQSEvent } from 'aws-lambda';

/** Works through the jobs queue, which other services hand records to. */
export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) JSON.parse(record.body);
};
