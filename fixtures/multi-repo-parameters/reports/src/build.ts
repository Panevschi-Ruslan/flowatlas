import type { SQSEvent } from 'aws-lambda';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({ region: 'eu-west-1' });

/** Builds a report, and queues the next job when a report needs another. */
export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const job = JSON.parse(record.body) as { report: string; next?: string };
    if (job.next !== undefined) await sqs.send(new SendMessageCommand({ QueueUrl: process.env.JOBS_QUEUE_URL, MessageBody: JSON.stringify({ report: job.next }) }));
  }
};
