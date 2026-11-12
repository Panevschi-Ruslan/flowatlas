import { useRouter } from 'next/router';

/** The orders page: `push` taken out of the router, opening one order. */
export default function OrdersPage({ ids }: { ids: string[] }) {
  const { push } = useRouter();
  return (
    <ul>
      {ids.map((id) => (
        <li key={id} onClick={() => push(`/orders/${id}`)}>
          {id}
        </li>
      ))}
    </ul>
  );
}
