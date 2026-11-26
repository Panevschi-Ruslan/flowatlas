import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({});

/** An alert onto the queue the service's parameter names. */
export const handler = async (event: { text: string }) => {
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.ALERTS_QUEUE_URL, MessageBody: JSON.stringify(event) }));
};
