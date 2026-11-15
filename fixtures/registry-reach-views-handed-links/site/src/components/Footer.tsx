import Link from 'next/link';

/** The footer's entries: two addresses, and a line with none. */
const FOOTER = [{ href: '/legal', label: 'Legal' }, { href: '/status', label: 'Status' }, { label: 'Made with care' }];

/** Next's own link over a list: one navigation per entry with an address. */
export default function Footer() {
  return (
    <footer>
      {FOOTER.map((entry) => ('href' in entry ? <Link key={entry.label} href={entry.href}>{entry.label}</Link> : <span key={entry.label}>{entry.label}</span>))}
    </footer>
  );
}
