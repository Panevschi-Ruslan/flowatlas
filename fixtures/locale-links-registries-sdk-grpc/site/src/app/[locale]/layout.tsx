import type { ReactNode } from 'react';
import Footer from '../../components/Footer';
import { LOCALES } from '../../i18n/locales';

export const dynamicParams = false;

/** One build of every page per language the site declares. */
export const generateStaticParams = () => LOCALES.map((locale) => ({ locale }));

export default function LocaleLayout({ children }: { children: ReactNode }) {
  return (
    <html>
      <body>
        {children}
        <Footer />
      </body>
    </html>
  );
}
