export interface CreateOrderDto {
  customerId: string;
  total: number;
}

export interface OrderDto {
  id: string;
  customerId: string;
  total: number;
  status: string;
}
