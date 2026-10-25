import AWS from 'aws-sdk';
import { PAGES_BUCKET } from '../lib/s3';

const s3 = new AWS.S3({ region: 'eu-west-1' });

/** A batch of pages scanned elsewhere, written under `imports/` in one go. */
interface Batch {
  batch: string;
  body: string;
}

export const handler = async (batch: Batch): Promise<void> => {
  await s3.upload({ Bucket: PAGES_BUCKET, Key: `imports/${batch.batch}.tiff`, Body: batch.body }).promise();
};
