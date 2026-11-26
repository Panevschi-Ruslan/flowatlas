import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** A link into the help pages: the address is written from under `/help`. */
export function HelpLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={`/help${to}`}>{children}</Link>;
}
