/** Puts a scheme in front of an address its platform hands over without one. */
function withScheme(url: string | undefined): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `https://${url}`;
}

const PREVIEW_URL = process.env.PREVIEW_HOST ? `https://${process.env.PREVIEW_HOST}` : '';

/** Where the listings are served: the deployment's address, a preview's, or this machine's. */
export const APP_URL = withScheme(process.env.PUBLIC_APP_URL) || PREVIEW_URL || 'http://localhost:4300';
