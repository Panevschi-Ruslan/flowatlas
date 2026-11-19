'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

/** The site's navigation: every address written without the locale, which the middleware puts in front. */
export default function Nav({ page }: { page: number }) {
  const router = useRouter();
  return (
    <nav>
      <Link href="/search">Search</Link>
      <Link href="/about-us">About us</Link>
      <Link href="/fr">Français</Link>
      <Link href="/admin">Admin</Link>
      <button onClick={() => router.push(`/posts/page/${page + 1}`)}>Next page</button>
    </nav>
  );
}
