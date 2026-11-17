import Link from 'next/link';
import type { ReactNode } from 'react';

/** A link to the search, handed what follows `/search` straight after it, no `/` between. */
export function SearchLink({ query, children }: { query: string; children: ReactNode }) {
  return <Link href={`/search${query}`}>{children}</Link>;
}
