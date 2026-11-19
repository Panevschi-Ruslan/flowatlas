import Link from 'next/link';
import type { ReactNode } from 'react';

/** A link under the area, handed the rest of the address in a prop named for what it is. */
export function AreaLink({ path, children }: { path: string; children: ReactNode }) {
  return <Link href={`/area${path}`}>{children}</Link>;
}
