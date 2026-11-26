import { BatchProcessor, EventType, processPartialResponse } from '@aws-lambda-powertools/batch';
import type { Context, SQSEvent, SQSRecord } from 'aws-lambda';

const processor = new BatchProcessor(EventType.SQS);

const packOne = async (record: SQSRecord): Promise<void> => {
  const order = JSON.parse(record.body) as { orderId: string; items: string[] };
  if (order.items.length === 0) throw new Error(`nothing to pack for ${order.orderId}`);
};

/** Packs each order; the batch helper answers which ones failed, as its mapping says it will. */
export const handler = async (event: SQSEvent, context: Context) =>
  processPartialResponse(event, packOne, processor, { context });
