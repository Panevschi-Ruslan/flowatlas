import type { ScheduledEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

const documents = DynamoDBDocumentClient.from({ region: 'eu-west-1' });

/** Every night at two: counts the day's orders. */
export const handler = async (_event: ScheduledEvent): Promise<void> => {
  const found = await documents.send(new ScanCommand({ TableName: process.env.ORDERS_TABLE }));
  console.log('orders', found.Count ?? 0);
};
