/**
 * The browser's own copy of the two shapes.
 *
 * A frontend shipping its own copy of a shape is the ordinary way two sides of
 * a boundary drift apart: there is no import between them and no compiler that
 * sees both. `postcode` is missing from the address and `total` is text rather
 * than a number, which is what the request and the response halves report.
 */
export interface CreateOrderDto {
  customerId: string;
  channel: string;
  note: string;
  total: { amount: number; currency: string };
  shipTo: { line1: string; city: string };
}

export interface OrderDto {
  id: string;
  total: string;
  placedAt: string;
}
