import { useOrders } from '../hooks/use-orders';
import { useResource } from '../hooks/use-resource';

/**
 * The screen the whole reading aims at.
 *
 * Three files between the click and the address: the button is here, the hook
 * is next door, and the request is in the API module. `impact` from the route
 * that answers it ends at this component.
 */
export function OrdersPanel(props: { resourcePath: string }) {
  const orders = useOrders();
  const resource = useResource(props.resourcePath);

  return (
    <section>
      <button type="button" onClick={() => orders.refresh()}>
        Refresh
      </button>
      <button type="button" onClick={() => orders.rename('1', { name: 'renamed' })}>
        Rename
      </button>
      <button type="button" onClick={() => resource.load()}>
        Load
      </button>
    </section>
  );
}
