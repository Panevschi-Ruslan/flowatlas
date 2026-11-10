import env from '../env';

/** What an article's address holds in its last segment. */
export const pageSlug = ':pageSlug';

/** The start screen: the kiosk page where the desk runs as a kiosk, the home screen otherwise. */
export function startPath(): string {
  return env.KIOSK_MODE ? '/' : '/home';
}

/** An admin screen, with as many segments as the caller names. */
export function adminPath(...segments: string[]): string {
  return '/admin' + (segments.length > 0 ? `/${segments.join('/')}` : '');
}

/** The search screen, with the query on the end where there is one. */
export function findPath({ query }: { query?: string } = {}): string {
  const search = query === undefined ? '' : new URLSearchParams({ q: query }).toString();
  return `/search${search ? `?${search}` : ''}`;
}

/** Where an article is: its own path, which the server sends. */
export function pageUrl(doc: { path: string }): string {
  return doc.path;
}
