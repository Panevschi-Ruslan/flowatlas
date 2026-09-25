import { archiveOrder } from '../actions/orders';

/**
 * A screen whose address is where this file is, and whose button crosses a
 * process boundary by calling an imported function.
 */
export default function OrdersPage(props: { id: string }) {
  const onArchive = () => archiveOrder(props.id);
  return (
    <main>
      <h1>Orders</h1>
      <button type="button" onClick={onArchive}>
        Archive
      </button>
    </main>
  );
}
