import type { EventBridgeEvent } from 'aws-lambda';

/** Run by the rule on the orders bus that takes `OrderCancelled`. */
export const handler = async (event: EventBridgeEvent<'OrderCancelled', { orderId: string }>): Promise<void> => {
  console.log('refund', event.detail.orderId);
};
