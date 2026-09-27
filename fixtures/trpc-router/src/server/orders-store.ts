/** The work behind the ways in, so that reaching it is something to check. */

export const listOrders = ({ input }: { ctx: unknown; input: unknown }) => {
  const query = input as { customerId: string };
  return [{ id: 'ord-1', customerId: query.customerId }];
};

export const storeOrder = (body: { sku: string; quantity: number }) => ({
  id: 'ord-2',
  ...body,
});
