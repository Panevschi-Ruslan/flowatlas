import Link from 'next/link';

/** The portal's navigation: addresses written without the language, which the middleware puts in front. */
export default function Nav() {
  return (
    <nav>
      {/* `go` is shaped like a language and is none the portal declares: written without the prefix. */}
      <Link href="/go/pricing">Go: pricing plan</Link>
      <Link href="/de/pricing">Preise</Link>
    </nav>
  );
}
