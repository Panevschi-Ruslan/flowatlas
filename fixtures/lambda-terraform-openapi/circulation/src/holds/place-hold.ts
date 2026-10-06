import type { SQSEvent } from 'aws-lambda';

const holds: string[] = [];

/** Reads the queue the kiosk API's POST /holds sends the request to. */
export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const { itemId } = JSON.parse(record.body) as { itemId: string };
    holds.push(itemId);
  }
};
