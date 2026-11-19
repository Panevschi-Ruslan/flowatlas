import { expireOrders } from '../../utils/orders';

export default defineTask({
  meta: { name: 'orders:expire', description: 'Expire orders left unpaid' },
  run({ payload }) {
    return { result: expireOrders(payload.olderThan as number) };
  },
});
