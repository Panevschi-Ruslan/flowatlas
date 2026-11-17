'use client';

import { useSearchParams } from 'next/navigation';
import { FindLink } from './FindLink';
import { PortalLink } from './PortalLink';

/** Links to the finder, one with a query written out and one read from the address, and one under the portal. */
export default function Footer() {
  const search = useSearchParams();
  return (
    <footer>
      <FindLink terms="?q=shoes">Shoes</FindLink>
      <FindLink terms={search.get('again')}>Again</FindLink>
      <PortalLink href={search.get('to')}>Portal</PortalLink>
    </footer>
  );
}
