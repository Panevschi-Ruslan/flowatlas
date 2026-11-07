import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({ region: 'eu-central-1' });

/** Run once a new member confirms their address: queues the welcome notice. */
export const handler = async (event: { userName: string }): Promise<{ userName: string }> => {
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.NOTICES_QUEUE_URL, MessageBody: JSON.stringify({ kind: 'welcome', member: event.userName }) }));
  return event;
};
