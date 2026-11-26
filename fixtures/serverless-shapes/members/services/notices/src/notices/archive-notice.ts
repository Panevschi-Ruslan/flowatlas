import type { S3Event } from 'aws-lambda';

/** Notified of every `.json` written to the archive bucket. */
export const handler = async (event: S3Event): Promise<void> => {
  for (const record of event.Records) console.log('archived', record.s3.object.key);
};
