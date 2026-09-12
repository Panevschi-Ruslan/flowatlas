/**
 * The gateway's own copy of the invoice shape.
 *
 * Deliberately *not* taken from `@fx/contracts`: `billing` declares its own
 * `InvoiceDto` too, so the two ends of the marker edge carry different type ids
 * and P10 has a real pair to compare. Only `OrderDto` is shared (D6).
 */
export interface InvoiceDto {
  id: string;
  orderId: string;
  amount: number;
}
