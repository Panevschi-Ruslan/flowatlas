import { listOrders, updateOrder, type OrderDto, type UpdateOrderDto } from '../api/orders';

/**
 * What a request belongs to, spelled the way React spells it.
 *
 * A custom hook is an ordinary function that a component calls, so the walk
 * from the request back to the screen goes through plain calls rather than
 * through a container. Nothing here declares that this is a hook except its
 * name, and nothing declares that a component will call it except that one
 * does.
 */
export const useOrders = () => {
  const refresh = (): Promise<OrderDto[]> => listOrders();
  const rename = (id: string, patch: UpdateOrderDto): Promise<OrderDto> => updateOrder(id, patch);
  return { refresh, rename };
};
