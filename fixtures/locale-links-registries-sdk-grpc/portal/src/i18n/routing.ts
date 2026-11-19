import { defineRouting } from 'next-intl/routing';

/** The two languages the portal is built in. */
export const routing = defineRouting({ locales: ['en', 'de'], defaultLocale: 'en' });
