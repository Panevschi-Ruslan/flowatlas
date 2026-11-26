'use client';

import { useSearchParams } from 'next/navigation';
import { SearchLink } from './SearchLink';

/** Back to the last search, what follows `/search` read from the query: a query or a further segment. */
export default function Recent() {
  const search = useSearchParams();
  return <SearchLink query={search.get('last')}>Last search</SearchLink>;
}
