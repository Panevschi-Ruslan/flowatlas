/**
 * The gateway's own copy of the order shapes.
 *
 * Identical in base and in head: this file is what makes the head revision's
 * new required field a break rather than a coordinated change. Nobody edited
 * the gateway, which is exactly the situation a compiler cannot see.
 */
export interface CreateOrderDto {
  customerId: string;
  note: string;
}

export interface OrderDto {
  id: string;
  customerId: string;
  status: string;
}
