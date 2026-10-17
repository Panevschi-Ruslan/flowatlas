/** What `POST /invoices` is given. The `main` branch adds a required `currency`. */
export class CreateInvoiceDto {
  orderId!: string;
  amount!: number;
}

/**
 * Billing's own reading of `order.placed`, drifted from what `orders` sends
 * (`customerRef` against `customerId`). It runs in every environment, so a
 * check lists it under "already deployed" and never fails a deploy on it.
 */
export interface OrderPlacedEvent {
  orderId: string;
  customerRef: string;
}
