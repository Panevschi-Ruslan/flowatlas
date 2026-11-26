'use client';

import { useSearchParams } from 'next/navigation';
import { AppLink } from './AppLink';

/** Back into the application where the visitor left it, the rest of the address in the query. */
export default function Resume() {
  const search = useSearchParams();
  return <AppLink to={search.get('from')}>Resume</AppLink>;
}
