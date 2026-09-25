import { archiveOrder, cancelOrder } from '../actions/orders';

/**
 * A screen that crosses the boundary twice, once each way of writing it.
 *
 * Both buttons compile to a request the bundler writes; neither call names an
 * address. If the built action reads as nothing, this component reaches one
 * boundary out of two and nothing says which.
 */
export default function OrdersPage(props: { id: string }) {
  const onArchive = () => archiveOrder({ id: props.id });
  const onCancel = () => cancelOrder(props.id);
  return (
    <main>
      <h1>Orders</h1>
      <button type="button" onClick={onArchive}>
        Archive
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </main>
  );
}
