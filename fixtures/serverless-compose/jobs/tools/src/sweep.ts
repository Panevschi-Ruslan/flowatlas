import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({ region: 'eu-west-1' });

/** Every hour, a job that tidies up after the others. */
export const handler = async (): Promise<void> => {
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.JOBS_QUEUE_URL, MessageBody: JSON.stringify({ kind: 'sweep' }) }));
};
