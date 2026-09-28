import { trpc } from './trpc';

/**
 * Every way a request for a procedure can end, one call each.
 *
 * - `orders.list` as a query and `orders.create` as a mutation reach `api`, the
 *   service `apiTarget` names.
 * - `orders.list` as a mutation reaches the same procedure, which was declared a
 *   query, and the server refuses it.
 * - `orders.archive` is declared by `admin` alone, which nothing says this front
 *   end calls.
 */
export function Orders({ customerId }: { customerId: string }) {
  const orders = trpc.orders.list.useQuery({ customerId });
  const create = trpc.orders.create.useMutation();
  const refresh = trpc.orders.list.useMutation();
  const archive = trpc.orders.archive.useMutation();
  return (
    <button
      onClick={() => {
        create.mutate({ sku: 'sku-1', quantity: 1 });
        refresh.mutate({ customerId });
        archive.mutate({ id: 'ord-1' });
      }}
    >
      {String(orders.data)}
    </button>
  );
}

/** A step of the path chosen at run time, which names no procedure. */
export function Section({ section }: { section: string }) {
  const listed = trpc[section].list.useQuery();
  return <div>{String(listed.data)}</div>;
}
