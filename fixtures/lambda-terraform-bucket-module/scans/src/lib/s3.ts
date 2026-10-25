import { S3Client } from '@aws-sdk/client-s3';

export const s3 = new S3Client({ region: 'eu-west-1' });

/** The scanned pages, kept with every version. */
export const PAGES_BUCKET = 'library-page-scans';

/** The thumbnails of the pages, one version each. */
export const THUMBS_BUCKET = 'library-page-thumbs';

/** The withdrawn pages, kept with every version through the s3-bucket module. */
export const ARCHIVE_BUCKET = 'library-page-archive';
