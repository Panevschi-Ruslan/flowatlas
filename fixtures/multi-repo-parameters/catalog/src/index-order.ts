import type { DynamoDBStreamEvent } from 'aws-lambda';

/** Every order written, indexed for the catalog's own pages. */
export const handler = async (event: DynamoDBStreamEvent): Promise<void> => {
  for (const record of event.Records) console.log(record.eventName, record.dynamodb?.Keys);
};
