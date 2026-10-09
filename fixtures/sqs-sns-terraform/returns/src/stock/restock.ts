import type { SQSEvent } from 'aws-lambda';
import type { ReturnedItem } from '../lib/returns-queue';

const shelves = new Map<string, number>();

/** Reads the restock queue, which the topic fans out to. */
export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const item = JSON.parse(record.body) as ReturnedItem;
    shelves.set(item.branchId, (shelves.get(item.branchId) ?? 0) + 1);
  }
};
