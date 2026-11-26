import { createNavigation } from 'next-intl/navigation';
import { defineRouting } from 'next-intl/routing';

/** The locales the site is written in, the first the one an address without a locale shows. */
export const routing = defineRouting({
  locales: ['en', 'fr'],
  defaultLocale: 'en',
});

/** The router's own link and navigation, which put the visitor's locale in front of the address. */
export const { Link, redirect, useRouter } = createNavigation(routing);
