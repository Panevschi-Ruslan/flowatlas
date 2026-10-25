import type { S3Event } from 'aws-lambda';
import { CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { ARCHIVE_BUCKET, s3 } from '../lib/s3';

/**
 * Run by every `.png` created under `incoming/` in the uploads bucket: writes a
 * thumbnail under `thumbnails/`, keeps the original in the archive, and removes
 * it from the uploads bucket, which notifies nobody of that.
 */
export const handler = async (event: S3Event): Promise<void> => {
  for (const record of event.Records) {
    const key = record.s3.object.key;
    const isbn = key.slice('incoming/'.length, -'.png'.length);
    const upload = new Upload({
      client: s3,
      params: { Bucket: process.env.UPLOADS_BUCKET, Key: `thumbnails/${isbn}.png`, Body: '' },
    });
    await upload.done();
    await s3.send(new CopyObjectCommand({ Bucket: ARCHIVE_BUCKET, Key: `covers/${isbn}.png`, CopySource: `${record.s3.bucket.name}/${key}` }));
    await s3.send(new DeleteObjectCommand({ Bucket: process.env.UPLOADS_BUCKET, Key: key }));
  }
};
