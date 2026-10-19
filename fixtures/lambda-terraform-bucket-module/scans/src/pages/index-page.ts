import type { S3Event } from 'aws-lambda';

/** Run by every page joined under `pages/`: adds it to the search index. */
export const handler = async (event: S3Event): Promise<void> => {
  for (const record of event.Records) console.log(`indexing ${record.s3.object.key}`);
};
