import type { SQSEvent } from 'aws-lambda';
import { bookCourier } from '../lib/courier';

/**
 * Books a courier for each order of the batch. Its mapping says it reports
 * the messages that failed, and it never does: a booking that throws is
 * logged and the batch still counts as a success.
 */
export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    try {
      await bookCourier(JSON.parse(record.body) as { orderId: string });
    } catch (error) {
      console.error('booking failed', record.messageId, error);
    }
  }
};
