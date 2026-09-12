/** Payload shapes carried on the in-house bus. */

export interface OrderCreatedEvent {
  orderId: string;
  customerId: string;
}

export interface OrderCancelledEvent {
  orderId: string;
  reason: string;
}

export interface OrderArchivedEvent {
  orderId: string;
  archivedAt: string;
}

export interface OrderExport {
  rows: number;
}
