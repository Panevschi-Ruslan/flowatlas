import type { DynamoDBStreamEvent } from 'aws-lambda';

const notices: string[] = [];

/** Run by the orders table's stream: every order placed, changed or removed. */
export const handler = async (event: DynamoDBStreamEvent): Promise<void> => {
  for (const record of event.Records) {
    notices.push(`${record.eventName ?? 'UNKNOWN'} ${record.dynamodb?.NewImage?.['orderId']?.S ?? '?'}`);
  }
};
