/** The languages the site is built in; the first is the one shown without a prefix. */
export const LOCALES = ['en', 'fr'] as const;

export type Locale = (typeof LOCALES)[number];
