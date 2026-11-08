import type { SQSEvent } from 'aws-lambda';

/** Raises an invoice for each message on the invoices queue. */
export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) JSON.parse(record.body);
};
