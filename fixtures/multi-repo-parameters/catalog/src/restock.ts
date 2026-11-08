import type { ScheduledEvent } from 'aws-lambda';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

const sns = new SNSClient({ region: 'eu-west-1' });
const sqs = new SQSClient({ region: 'eu-west-1' });

/** Says a product is back in stock, and keeps a record of it on the audit queue. */
export const handler = async (event: ScheduledEvent): Promise<void> => {
  const { sku } = event.detail as { sku: string };
  await sns.send(new PublishCommand({ TopicArn: process.env.RESTOCK_TOPIC_ARN, Message: JSON.stringify({ sku }) }));
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.AUDIT_QUEUE_URL, MessageBody: JSON.stringify({ sku, restocked: true }) }));
};
