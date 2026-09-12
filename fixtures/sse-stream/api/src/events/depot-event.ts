/** What travels on the bus. One shape, so the payload on `emits` is readable. */
export interface DepotEvent {
  type: string;
  depotId: string;
  orderId?: string;
}
