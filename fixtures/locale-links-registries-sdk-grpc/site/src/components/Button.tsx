import type { ReactNode } from 'react';
import { LangLink } from '../i18n/LangLink';

/** A button, or a link styled as one where it is handed an address. */
export function Button({ href, children }: { href?: string; children: ReactNode }) {
  if (href === undefined) return <button type="button">{children}</button>;
  if (href.startsWith('mailto:')) return <a href={href}>{children}</a>;
  return <LangLink href={href}>{children}</LangLink>;
}
