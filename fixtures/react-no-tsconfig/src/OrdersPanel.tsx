import { listOrders } from './api/orders';

/**
 * The one screen, and the reason this fixture exists.
 *
 * It is a component by the ordinary test — a capitalised function with markup
 * coming back out of it — and the markup is what a repository with no tsconfig
 * could not be told to parse. If the snapshot beside this file holds this
 * component and the request it reaches, the fallback options parse markup.
 */
export function OrdersPanel() {
  return (
    <section>
      <button type="button" onClick={() => listOrders()}>
        Load orders
      </button>
    </section>
  );
}
