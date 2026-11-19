/**
 * The worker's own copy of the orders tree's type, written by hand because
 * the orders service is another repository and its tree is not installed
 * here. It has drifted: `place` is handed a `qty` the procedure calls
 * `quantity`, and is read back with a `total` the procedure never answers.
 */
export interface NewOrder {
  sku: string;
  qty: number;
}

export interface PlacedOrder {
  id: string;
  total: number;
}

export interface Order {
  id: string;
  sku: string;
  quantity: number;
}

export interface OrdersApi {
  orders: {
    place(input: NewOrder): Promise<PlacedOrder>;
    get(input: { id: string }): Promise<Order>;
    count(input: { since: string }): Promise<number>;
  };
}
