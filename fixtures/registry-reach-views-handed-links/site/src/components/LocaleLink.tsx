'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useLocale } from './use-locale';

/** Another link under the visitor's language, whose one use hands a value read when the page runs. */
export function LocaleLink({ target, children }: { target: string; children: ReactNode }) {
  const locale = useLocale();
  return <Link href={`/${locale}${target}`}>{children}</Link>;
}
