'use client';

import { useSearchParams } from 'next/navigation';
import { AreaLink } from './AreaLink';

/** Back into the area where the visitor came from, the rest of the address in the query. */
export default function Return() {
  const search = useSearchParams();
  return <AreaLink path={search.get('next')}>Area</AreaLink>;
}
