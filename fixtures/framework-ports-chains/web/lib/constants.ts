/** Puts a scheme in front of an address a platform hands over without one. */
function withScheme(url: string | undefined): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `https://${url}`;
}

const PREVIEW_URL = process.env.PREVIEW_HOST ? `https://${process.env.PREVIEW_HOST}` : '';
const STAGING_URL = process.env.STAGING_HOST ? `https://${process.env.STAGING_HOST}` : '';
const REVIEW_APP_URL = process.env.REVIEW_APP_NAME ? `https://${process.env.REVIEW_APP_NAME}.apps.example.test` : '';
const EDGE_URL = process.env.EDGE_HOST ? `https://${process.env.EDGE_HOST}` : '';

/** Where the application is served: a deployment's address, a preview's, or this machine's. */
export const APP_URL =
  withScheme(process.env.PUBLIC_APP_URL) ||
  PREVIEW_URL ||
  STAGING_URL ||
  REVIEW_APP_URL ||
  EDGE_URL ||
  'http://localhost:3000';

/** Where the status service is: the public setting, the one the status service claims, or this machine's. */
export const STATUS_URL = process.env.PUBLIC_STATUS_URL || process.env.STATUS_API_URL || 'http://localhost:4400';
