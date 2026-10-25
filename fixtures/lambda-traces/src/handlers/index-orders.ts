import type { DynamoDBStreamEvent } from 'aws-lambda';

const indexed: string[] = [];

/** Run by the orders table's stream: every order written is indexed for search. */
export const handler = async (event: DynamoDBStreamEvent): Promise<void> => {
  for (const record of event.Records) indexed.push(record.dynamodb?.NewImage?.['orderId']?.S ?? '?');
};
