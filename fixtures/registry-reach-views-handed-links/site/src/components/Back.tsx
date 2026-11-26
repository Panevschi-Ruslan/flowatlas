'use client';

import { useSearchParams } from 'next/navigation';
import { LocaleLink } from './LocaleLink';

/** Back to where the visitor came from, an address in the query. */
export default function Back() {
  const params = useSearchParams();
  return <LocaleLink target={params.get('next')}>Back</LocaleLink>;
}
