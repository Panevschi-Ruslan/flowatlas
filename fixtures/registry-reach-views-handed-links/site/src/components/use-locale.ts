'use client';

import { useParams } from 'next/navigation';

/** The language of the page being shown. */
export const useLocale = (): string => useParams<{ locale: string }>().locale ?? 'en';
