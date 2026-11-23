/** The frames the shop publishes on `order_updates`, told apart by `type`. */
export interface OrderReadyFrame {
  type: 'ORDER_READY';
  orderId: string;
  label?: string;
}

export interface OrderCancelledFrame {
  type: 'ORDER_CANCELLED';
  orderId: string;
  reason: string;
}

export type OrderFrame = OrderReadyFrame | OrderCancelledFrame;
