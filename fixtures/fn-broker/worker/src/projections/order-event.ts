/**
 * What every channel here carries, declared once.
 *
 * In one file rather than in each consumer, so that the two spellings of the
 * same consumer are compared against the same declaration and a difference
 * between them can only be the reading and never the type.
 */
export interface OrderEvent {
  readonly orderId: string;
  readonly total: number;
}
