import Link from 'next/link';

/** A link to one tag: its prop is glued into a segment, and every use writes a name, not an address. */
export function TagLink({ name }: { name: string }) {
  return <Link href={`/tags/t-${name}`}>#{name}</Link>;
}
