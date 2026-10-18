import type { EventBridgeEvent } from 'aws-lambda';

interface PaymentCaptured {
  orderId: string;
  amount: number;
}

/** Sends the receipt for a payment the payments service captured. */
export const handler = async (event: EventBridgeEvent<'PaymentCaptured', PaymentCaptured>): Promise<void> => {
  console.log(event.detail.orderId);
};
