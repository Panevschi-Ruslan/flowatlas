/** What this repository puts on the wire, and what it expects to be handed. */
export interface OrderCreated {
  readonly orderId: string;
  readonly customerId: string;
  readonly total: number;
}

export interface InvoiceIssued {
  readonly invoiceId: string;
  readonly orderId: string;
  /** Text here, a number in the document that declares the publisher. */
  readonly amount: string;
}
