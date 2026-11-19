'use client';

import { useSearchParams } from 'next/navigation';
import { ConsoleLink } from './ConsoleLink';

/** Back into the console where the visitor came from, the rest of the address in the query. */
export default function Back() {
  const search = useSearchParams();
  return <ConsoleLink target={search.get('back')}>Console</ConsoleLink>;
}
