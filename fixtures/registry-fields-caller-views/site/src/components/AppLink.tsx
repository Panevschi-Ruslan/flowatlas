import Link from 'next/link';
import type { ReactNode } from 'react';

/** A link under the application's own area, handed the rest of the address. */
export function AppLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link href={`/app${to}`}>{children}</Link>;
}
