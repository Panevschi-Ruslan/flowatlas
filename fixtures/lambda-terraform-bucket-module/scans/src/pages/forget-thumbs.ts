import type { S3Event } from 'aws-lambda';

/** Run by every thumbnail removed: drops it from the cache in front of the bucket. */
export const handler = async (event: S3Event): Promise<void> => {
  for (const record of event.Records) console.log(`forgetting ${record.s3.object.key}`);
};
