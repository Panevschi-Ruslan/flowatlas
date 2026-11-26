'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useLocale } from './use-locale';

/** Next's link under the visitor's language: every use hands the address after it as a value, `to`. */
export function NavLink({ to, children }: { to: string; children: ReactNode }) {
  const locale = useLocale();
  return <Link href={`/${locale}${to}`}>{children}</Link>;
}
