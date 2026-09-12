/**
 * What `POST /orders` is given and what it answers with.
 *
 * This is the head revision. One required field was added and nothing else
 * about the file changed. That single line is what a cross-repository diff has
 * to turn into "the gateway does not send it, and this breaks".
 */
export class CreateOrderDto {
  customerId!: string;
  note!: string;
  /** Added here and nowhere else. The gateway still sends the old shape. */
  channel!: string;
}

export interface OrderDto {
  id: string;
  customerId: string;
  status: string;
}

/** What goes on `order.created`. `billing` declares its own, differently. */
export interface OrderCreatedEvent {
  orderId: string;
  customerId: string;
}
