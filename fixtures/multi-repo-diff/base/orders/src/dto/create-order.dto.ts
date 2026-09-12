/**
 * What `POST /orders` is given and what it answers with.
 *
 * The head revision of this fixture adds one required field here and changes
 * nothing else about it. That single line is what a cross-repository diff has
 * to turn into "the gateway does not send it, and this breaks".
 */
export class CreateOrderDto {
  customerId!: string;
  note!: string;
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
