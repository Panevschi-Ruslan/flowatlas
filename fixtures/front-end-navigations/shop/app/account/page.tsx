import { redirect } from 'next/navigation';

/** The account page of the newer router: with no session it redirects to the orders page. */
export default function AccountPage({ session }: { session?: string }) {
  if (session === undefined) redirect('/orders');
  return <section>{session}</section>;
}
