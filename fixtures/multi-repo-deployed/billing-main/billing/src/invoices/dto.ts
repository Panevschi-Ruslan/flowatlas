/** What `POST /invoices` is given. `currency` is new on `main`, and required. */
export class CreateInvoiceDto {
  orderId!: string;
  amount!: number;
  currency!: string;
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

/** What goes on `invoice.paid`, published from `main` on. */
export interface InvoicePaidEvent {
  invoiceId: string;
  orderId: string;
}
