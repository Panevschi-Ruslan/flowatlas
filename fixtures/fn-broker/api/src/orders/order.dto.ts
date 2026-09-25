/** What every channel in this fixture carries. */
export interface OrderEvent {
  readonly orderId: string;
  readonly total: number;
}
