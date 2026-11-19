export interface Order {
  id: string;
  total: number;
  customerId: string;
}

const orders: Order[] = [];

export const listOrders = (): Order[] => orders;

export const ordersOf = (customerId: string): Order[] => orders.filter((order) => order.customerId === customerId);
