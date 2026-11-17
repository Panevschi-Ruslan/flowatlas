import Link from 'next/link';
import type { ReactNode } from 'react';

/** A link under the portal, handed the rest of the address after a `/`. */
export function PortalLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={`/portal/${href}`}>{children}</Link>;
}
