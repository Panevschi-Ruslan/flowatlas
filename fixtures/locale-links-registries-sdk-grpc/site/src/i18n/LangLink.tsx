'use client';

import Link from 'next/link';
import type { ComponentProps } from 'react';
import { withLang } from './with-lang';
import { useLocale } from './use-locale';

/** Next's link with the visitor's language put in front, so every use writes the address without it. */
export function LangLink({ href, ...props }: ComponentProps<typeof Link> & { href: string }) {
  const locale = useLocale();
  return <Link {...props} href={withLang(locale, href)} />;
}
