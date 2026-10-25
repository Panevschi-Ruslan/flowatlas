import { CompleteMultipartUploadCommand } from '@aws-sdk/client-s3';
import { PAGES_BUCKET, s3 } from '../lib/s3';

/** A page scanned in parts: the parts are joined into one object under `pages/`. */
interface StoredPage {
  page: string;
  uploadId: string;
}

export const handler = async (stored: StoredPage): Promise<void> => {
  await s3.send(new CompleteMultipartUploadCommand({ Bucket: PAGES_BUCKET, Key: `pages/${stored.page}.tiff`, UploadId: stored.uploadId }));
};
