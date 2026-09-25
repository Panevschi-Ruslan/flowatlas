/**
 * The data layer, written as a module of functions rather than as a class.
 *
 * This is the ordinary shape in a repository built on the file-system router,
 * and it is worth a fixture of its own: the data-layer reader walks class
 * methods, so nothing here becomes a query node today. The functions are still
 * read as functions and the edges to them are drawn, so a flow from a route
 * ends here rather than at the route.
 */
interface OrderRecord {
  id: string;
  name: string;
  archived: boolean;
}

const orders = new Map<string, OrderRecord>();

export const listOrders = async (): Promise<OrderRecord[]> => [...orders.values()];

export const findOrder = async (id: string): Promise<OrderRecord | undefined> => orders.get(id);

export const saveOrder = async (order: OrderRecord): Promise<OrderRecord> => {
  orders.set(order.id, order);
  return order;
};

export const patchOrder = async (id: string, patch: Partial<OrderRecord>): Promise<OrderRecord | undefined> => {
  const found = orders.get(id);
  if (found === undefined) return undefined;
  const next = { ...found, ...patch };
  orders.set(id, next);
  return next;
};

export const archive = async (id: string): Promise<void> => {
  await patchOrder(id, { archived: true });
};
