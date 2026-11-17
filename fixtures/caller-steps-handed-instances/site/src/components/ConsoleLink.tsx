import Link from 'next/link';
import type { ReactNode } from 'react';

/** A link under the console, the address built in a const before the link is handed it. */
export function ConsoleLink(props: { target: string; children: ReactNode }) {
  const address = `/console${props.target}`;
  return <Link href={address}>{props.children}</Link>;
}
