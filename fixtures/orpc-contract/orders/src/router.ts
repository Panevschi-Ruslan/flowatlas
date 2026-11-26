import { implement, ORPCError } from '@orpc/server';
import { contract } from './contract';
import { cancelOrder, listOrders } from './store';

interface Context {
  staff?: boolean;
}

const os = implement(contract).$context<Context>();

/** Every implementation below starts here, so this stands in front of each. */
function requireStaff({ context, next }: { context: Context; next: () => Promise<unknown> }) {
  if (context.staff !== true) throw new ORPCError('FORBIDDEN');
  return next();
}

const staff = os.use(requireStaff);

export const router = os.router({
  orders: {
    list: staff.orders.list.handler(async ({ input }) => listOrders(input.sku)),
    cancel: staff.orders.cancel.handler(async ({ input, errors }) => {
      const cancelled = await cancelOrder(input.id);
      if (cancelled === 'missing') throw errors.NOT_FOUND();
      if (cancelled === 'shipped') throw errors.ALREADY_SHIPPED();
      return { id: input.id };
    }),
    // Implemented and never declared: the contract has no such member.
    refund: staff.orders.refund.handler(async () => ({ refunded: true })),
  },
});
