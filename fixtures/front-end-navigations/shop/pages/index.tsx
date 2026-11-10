import Link from 'next/link';
import { useRouter } from 'next/router';

/** The shop's start page: a link to the orders, one to an order by its pathname, and a button that opens the account. */
export default function HomePage() {
  const router = useRouter();
  const account = () => router.push('/account');
  return (
    <main>
      <Link href="/orders">Orders</Link>
      <Link href={{ pathname: '/orders/[id]', query: { id: 'latest' } }}>Latest</Link>
      <button onClick={account}>Account</button>
    </main>
  );
}
