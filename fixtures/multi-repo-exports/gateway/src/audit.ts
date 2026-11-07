import type { SQSEvent } from 'aws-lambda';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({ region: 'eu-west-1' });

/** Every placed order, handed on to the audit queue of a billing service. */
export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    await sqs.send(new SendMessageCommand({ QueueUrl: process.env.AUDIT_QUEUE_URL, MessageBody: record.body }));
  }
};
