/**
 * What the browser expects back.
 *
 * Declared here rather than read from `@fx/contracts`, because the two sides of
 * a boundary drifting apart is what P10 will compare, and a frontend that ships
 * its own copy of a shape is the ordinary way that happens.
 */
export interface OrderDto {
  id: string;
  customerId: string;
  status: string;
  total: { amount: number; currency: string };
}
