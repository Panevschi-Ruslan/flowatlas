import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({ region: 'eu-west-1' });

/** Ships an order: hands the platform a job for it, and an audit record of it. */
export const handler = async (event: { id: string }): Promise<void> => {
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.JOBS_QUEUE_URL, MessageBody: JSON.stringify(event) }));
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.AUDIT_QUEUE_URL, MessageBody: event.id }));
};
