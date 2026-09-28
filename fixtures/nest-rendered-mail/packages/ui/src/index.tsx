/** A link styled as a button, in a message the mail package renders. */
export function ButtonLink({ href, label }: { href: string; label: string }) {
  return <a href={href}>{label}</a>;
}
