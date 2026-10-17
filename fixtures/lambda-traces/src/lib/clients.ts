import { LambdaClient } from '@aws-sdk/client-lambda';
import { SFNClient } from '@aws-sdk/client-sfn';
import { SQSClient } from '@aws-sdk/client-sqs';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/** One client of each for the whole service, the way the SDK's own examples keep them. */
export const documents = DynamoDBDocumentClient.from({ region: 'eu-west-1' });
export const queues = new SQSClient({ region: 'eu-west-1' });
export const workflows = new SFNClient({ region: 'eu-west-1' });
export const functions = new LambdaClient({ region: 'eu-west-1' });

export interface Order {
  orderId: string;
  customerId: string;
  items: string[];
}

/** What a function is handed, as the bytes `Payload` takes. */
export const payloadOf = (value: unknown): Uint8Array =>
  Uint8Array.from(JSON.stringify(value), (character) => character.charCodeAt(0));
