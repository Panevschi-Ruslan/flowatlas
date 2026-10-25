import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { PAGES_BUCKET, s3 } from '../lib/s3';

/** One version of a scan, superseded by a better one. */
interface Superseded {
  page: string;
  version: string;
}

/** Removes the version for good: a delete naming its version leaves no marker. */
export const handler = async (superseded: Superseded): Promise<void> => {
  await s3.send(new DeleteObjectCommand({ Bucket: PAGES_BUCKET, Key: `pages/${superseded.page}.tiff`, VersionId: superseded.version }));
};
