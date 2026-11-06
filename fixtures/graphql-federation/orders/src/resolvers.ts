import { customerOrders, findOrder, listOrders, placeOrder } from './orders';

export const resolvers = {
  Query: {
    orders: () => listOrders(),
    regions: () => ['eu', 'us'],
  },
  Mutation: {
    placeOrder: (_parent: unknown, args: { input: { customerId: string; total: number } }) => placeOrder(args.input),
  },
  Order: {
    __resolveReference: (reference: { id: string }) => findOrder(reference.id),
    customer: (order: { customerId: string }) => ({ __typename: 'Customer', id: order.customerId }),
  },
  Customer: {
    __resolveReference: (reference: { id: string }) => ({ id: reference.id }),
    orders: (customer: { id: string }) => customerOrders(customer.id),
  },
};
