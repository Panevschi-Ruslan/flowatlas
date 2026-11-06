import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({ region: 'eu-central-1' });

/** Once a day in production, and whenever a membership lapses: queues a digest notice. */
export const handler = async (): Promise<void> => {
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.NOTICES_QUEUE_URL, MessageBody: JSON.stringify({ kind: 'digest' }) }));
};
