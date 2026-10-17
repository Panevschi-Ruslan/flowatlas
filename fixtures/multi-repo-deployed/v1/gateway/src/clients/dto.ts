/** The gateway's own copy of the shapes it sends to `orders`. */
export interface CreateOrderDto {
  bookId: string;
  quantity: number;
}

export interface OrderDto {
  id: string;
  bookId: string;
  status: string;
}
