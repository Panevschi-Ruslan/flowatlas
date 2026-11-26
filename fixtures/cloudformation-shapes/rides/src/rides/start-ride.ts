import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({ region: 'eu-central-1' });

/** POST /rides: starts a ride, and queues the dock it left for a recount, on the queue the docks stack exports. */
export const handler = async (event: { body?: string }): Promise<{ statusCode: number }> => {
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.DOCKS_QUEUE_URL, MessageBody: event.body ?? '{}' }));
  return { statusCode: 201 };
};
