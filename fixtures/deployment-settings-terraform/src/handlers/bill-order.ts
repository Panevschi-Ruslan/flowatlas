import type { SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { chargeOrder } from '../lib/courier';

/**
 * Charges each order of the batch and answers which charges failed. Its
 * mapping does not say it reports them, so the platform ignores the list.
 */
export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failed: SQSBatchItemFailure[] = [];
  for (const record of event.Records) {
    try {
      await chargeOrder(JSON.parse(record.body) as { orderId: string; total: number });
    } catch {
      failed.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failed };
};
