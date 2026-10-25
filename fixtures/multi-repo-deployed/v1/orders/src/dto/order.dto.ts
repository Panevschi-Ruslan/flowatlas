/** What `POST /orders` is given and what both routes answer with. */
export class CreateOrderDto {
  bookId!: string;
  quantity!: number;
}

export interface OrderDto {
  id: string;
  bookId: string;
  status: string;
}

/** What goes on `order.placed`. `billing` reads it differently, in every version. */
export interface OrderPlacedEvent {
  orderId: string;
  customerId: string;
}
