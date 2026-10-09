import type { SQSEvent } from 'aws-lambda';

export interface HoldRequest {
  itemId: string;
  borrowerId: string;
}

const holds: HoldRequest[] = [];

/** Reads the hold-requests queue, which the API sends to directly. */
export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) holds.push(JSON.parse(record.body) as HoldRequest);
};
