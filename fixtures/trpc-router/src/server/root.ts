import { ordersRouter } from './orders';
import { reportsRouter } from './reports';
import { router } from './trpc';

export const appRouter = router({
  orders: ordersRouter,
  // Written shorthand, so the member is named after the tree. cal.com writes one
  // of its twenty-seven members this way, and it is the spelling where the name
  // node carries the member's own symbol rather than the tree's — nine ways in
  // lost their address to that before the reader asked the checker instead.
  reportsRouter,
});
