import Link from 'next/link';

/** The store's header: its start page, and a search. */
export function Header() {
  return (
    <header>
      <Link href="/">Home</Link>
      <Link href="/search">Search</Link>
    </header>
  );
}
