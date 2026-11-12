import type { S3Event } from 'aws-lambda';

/** Notified of every `.pdf` created under `invoices/` in the invoices bucket. */
export const handler = async (event: S3Event): Promise<void> => {
  for (const record of event.Records) console.log('indexed', record.s3.object.key);
};
