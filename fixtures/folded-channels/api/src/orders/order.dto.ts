/**
 * The states an order moves through, written as a union.
 *
 * This is the whole fixture in one line: the set is closed, the compiler
 * already knows it, and every channel name below is derived from it.
 */
export type OrderState = 'ORDER_OPENED' | 'ORDER_ON_HOLD' | 'ORDER_CLOSED';

export interface LifecycleEvent {
  readonly orderId: string;
}
