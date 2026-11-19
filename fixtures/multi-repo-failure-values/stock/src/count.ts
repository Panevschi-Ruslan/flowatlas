import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

const sns = new SNSClient({ region: 'eu-west-1' });
const sqs = new SQSClient({ region: 'eu-west-1' });

/** Counts the stock: a job for each shelf, what failed to the failed queue, an alert when a shelf runs out. */
export const handler = async (event: { shelves: { id: string; empty: boolean; failed: boolean }[] }): Promise<void> => {
  for (const shelf of event.shelves) {
    await sqs.send(new SendMessageCommand({ QueueUrl: process.env.JOBS_QUEUE_URL, MessageBody: shelf.id }));
    if (shelf.failed) await sqs.send(new SendMessageCommand({ QueueUrl: process.env.FAILED_QUEUE_URL, MessageBody: shelf.id }));
    if (shelf.failed) await sqs.send(new SendMessageCommand({ QueueUrl: process.env.SPILL_QUEUE_URL, MessageBody: shelf.id }));
    if (shelf.empty) await sns.send(new PublishCommand({ TopicArn: process.env.ALERTS_TOPIC_ARN, Message: shelf.id }));
  }
};
