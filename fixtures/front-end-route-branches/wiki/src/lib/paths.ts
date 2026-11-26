import env from '../env';

/** A settings screen, with as many segments as the caller names. */
export function settingsPath(...segments: string[]): string {
  return '/settings' + (segments.length > 0 ? `/${segments.join('/')}` : '');
}

/** The start screen: the shared page where the wiki only shares one, the start page otherwise. */
export function startPath(): string {
  return env.PUBLIC_SHARE ? '/' : '/start';
}
