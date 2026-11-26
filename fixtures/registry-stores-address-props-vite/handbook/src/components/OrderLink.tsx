import Link from 'next/link';

/** A link to one order: the component's own navigation, its prop a segment of the address. */
export function OrderLink({ id }: { id: string }) {
  return <Link href={`/orders/${id}`}>Order {id}</Link>;
}
