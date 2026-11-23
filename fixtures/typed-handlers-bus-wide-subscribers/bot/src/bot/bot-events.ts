export interface OrderReadyEvent {
  type: 'ORDER_READY';
  orderId: string;
  label?: string;
}

export interface OrderPlacedEvent {
  type: 'ORDER_PLACED';
  orderId: string;
}

export interface OrderCancelledEvent {
  type: 'ORDER_CANCELLED';
  orderId: string;
}

/** Any message on the channel: its type is a plain string. */
export interface OrderEvent {
  type: string;
  orderId: string;
}

export type BotEvent = OrderReadyEvent | OrderPlacedEvent | OrderCancelledEvent;
