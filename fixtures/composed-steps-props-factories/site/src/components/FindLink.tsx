import Link from 'next/link';
import type { ReactNode } from 'react';

/** A link to the finder, handed its query straight after `/find`. */
export function FindLink({ terms, children }: { terms: string; children: ReactNode }) {
  return <Link href={`/find${terms}`}>{children}</Link>;
}
