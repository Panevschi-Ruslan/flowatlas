'use client';

import { Link as LocaleLink, useRouter } from '../i18n/routing';

/** The site's footer, written with the locale router's own link and navigation. */
export default function Footer() {
  const router = useRouter();
  return (
    <footer>
      <LocaleLink href="/search">Search</LocaleLink>
      <button onClick={() => router.replace('/about-us')}>About us</button>
    </footer>
  );
}
