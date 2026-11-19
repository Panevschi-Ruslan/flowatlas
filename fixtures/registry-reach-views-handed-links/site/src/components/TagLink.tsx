import Link from 'next/link';

/** A link to one tag: its prop is glued into a segment of the address, and its one use hands a value not read. */
export function TagLink({ name }: { name: string }) {
  return <Link href={`/tags/t-${name}`}>#{name}</Link>;
}
