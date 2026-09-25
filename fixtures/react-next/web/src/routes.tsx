import { OrdersPanel } from './components/OrdersPanel';
import { InvoicesPanel } from './components/InvoicesPanel';

/**
 * What a screen is, said by the router rather than by the component.
 *
 * A table of objects is one of the two forms the common router accepts, and it
 * is the only thing in this repository that says `OrdersPanel` is a screen a
 * browser can arrive at rather than a part of one.
 */
export const routes = [
  { path: '/orders', element: <OrdersPanel resourcePath="/api/invoices" /> },
  { path: '/invoices', element: <InvoicesPanel /> },
];
