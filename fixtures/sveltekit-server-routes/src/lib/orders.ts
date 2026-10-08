/** What the route handlers of this fixture hand their work to. */
export interface Order {
  id: string;
  total: number;
}

export const listOrders = async (): Promise<Order[]> => [];

export const oneOrder = async (id: string): Promise<Order> => ({ id, total: 0 });

export const removeOrder = async (id: string): Promise<void> => {
  void id;
};
