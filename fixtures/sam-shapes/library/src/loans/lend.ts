import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({ region: 'eu-central-1' });

/** POST /loans: lends a book, and queues a hold for the next reader on the queue the platform names. */
export const handler = async (event: { body?: string }): Promise<{ statusCode: number }> => {
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.HOLDS_QUEUE_URL, MessageBody: event.body ?? '{}' }));
  return { statusCode: 201 };
};
