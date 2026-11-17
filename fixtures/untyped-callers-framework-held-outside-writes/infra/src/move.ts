import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({});

/** A stock move, queued for restocking. */
export const handler = async (event: { sku: string; quantity: number }) => {
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.RESTOCK_URL, MessageBody: JSON.stringify(event) }));
};
