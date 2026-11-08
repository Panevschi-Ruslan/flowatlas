import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { SQSEvent } from 'aws-lambda';

const sns = new SNSClient({ region: 'eu-west-1' });
const sqs = new SQSClient({ region: 'eu-west-1' });

/** Indexes an audited event, hands a job on for it, and alerts the platform of a failed one. Batches of one. */
export const handler = async (event: SQSEvent): Promise<void> => {
  const [record] = event.Records;
  if (record === undefined) return;
  const audited = JSON.parse(record.body) as { failed?: boolean };
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.JOBS_QUEUE_URL, MessageBody: record.body }));
  if (audited.failed === true) await sns.send(new PublishCommand({ TopicArn: process.env.ALERTS_TOPIC_ARN, Message: record.body }));
};
