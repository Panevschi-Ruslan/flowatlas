import { LOCALES, type Locale } from './locales';

/** An address of the site with the visitor's language in front, where it is not the first one. */
export const withLang = (locale: Locale, href: string): string => {
  if (!href.startsWith('/')) return href;
  if (locale === LOCALES[0]) return href;
  return href === '/' ? `/${locale}` : `/${locale}${href}`;
};
