import { S3Client } from '@aws-sdk/client-s3';

export const s3 = new S3Client({ region: 'eu-west-1' });

/** Where covers are kept once they have been checked, written out. */
export const ARCHIVE_BUCKET = 'library-cover-archive';
