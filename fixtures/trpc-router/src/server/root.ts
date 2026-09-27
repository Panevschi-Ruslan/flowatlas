// A package this repository does not have. Its tree is real somewhere and
// nothing here can read it, which is the member `procedure-branch-unread` is for.
import { billingRouter } from '@acme/billing-api';
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
  // A branch whose value is a name this reading follows to neither a way in nor
  // a tree. Everything under `billing` is missing from the graph, and the row
  // says which branch, so a reader can decide whether that matters.
  billing: billingRouter,
});
