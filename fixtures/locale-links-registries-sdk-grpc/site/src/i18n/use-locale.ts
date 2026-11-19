'use client';

import { useParams } from 'next/navigation';
import { LOCALES, type Locale } from './locales';

/** The language of the page being shown. */
export const useLocale = (): Locale => {
  const { locale } = useParams<{ locale: Locale }>();
  return locale ?? LOCALES[0];
};
