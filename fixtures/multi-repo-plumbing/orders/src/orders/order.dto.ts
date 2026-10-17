export interface OrderDto {
  id: string;
  customerId: string;
  status: string;
  total: number;
}

export interface CreateOrderDto {
  customerId: string;
  total: number;
}
