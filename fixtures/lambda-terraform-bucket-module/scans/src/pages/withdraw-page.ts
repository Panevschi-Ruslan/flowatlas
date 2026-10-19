import { DeleteObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { ARCHIVE_BUCKET, PAGES_BUCKET, s3, THUMBS_BUCKET } from '../lib/s3';

/** A page withdrawn from the catalogue. */
interface Withdrawal {
  page: string;
}

/**
 * Withdraws a page: the scan is deleted naming no version, which the bucket
 * keeping versions turns into a delete marker, and its thumbnails are removed.
 * Its archived copy is deleted the same way, from a bucket the s3-bucket module
 * keeps versions of.
 */
export const handler = async (withdrawal: Withdrawal): Promise<void> => {
  await s3.send(new DeleteObjectCommand({ Bucket: PAGES_BUCKET, Key: `pages/${withdrawal.page}.tiff` }));
  await s3.send(new DeleteObjectCommand({ Bucket: ARCHIVE_BUCKET, Key: `pages/${withdrawal.page}.tiff` }));
  await s3.send(
    new DeleteObjectsCommand({
      Bucket: THUMBS_BUCKET,
      Delete: { Objects: [{ Key: `thumbs/${withdrawal.page}-small.png` }, { Key: `thumbs/${withdrawal.page}-large.png` }] },
    }),
  );
};
