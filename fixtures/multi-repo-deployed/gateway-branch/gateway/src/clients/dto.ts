/** The gateway's own copy of the shapes it sends to `orders` and `billing`. */
export interface CreateOrderDto {
  bookId: string;
  quantity: number;
}

export interface OrderDto {
  id: string;
  bookId: string;
  status: string;
}

/** What `billing` v1 takes. `billing` on `main` also requires a `currency`. */
export interface CreateInvoiceDto {
  orderId: string;
  amount: number;
}
