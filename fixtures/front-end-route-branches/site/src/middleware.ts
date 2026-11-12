import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

/** Puts the visitor's locale in front of every address written without one. */
export default createMiddleware(routing);

export const config = {
  matcher: ['/((?!api|_next|admin|.*\\..*).*)'],
};
