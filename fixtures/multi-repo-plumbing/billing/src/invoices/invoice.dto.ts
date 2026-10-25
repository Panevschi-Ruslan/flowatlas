export interface InvoiceDto {
  id: string;
  orderId: string;
  amount: number;
  status: string;
}

export interface CreateInvoiceDto {
  orderId: string;
  amount: number;
}

export interface OrderCreatedEvent {
  id: string;
  total: number;
}
