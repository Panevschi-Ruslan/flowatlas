import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({ region: 'eu-west-1' });

/** Closes the month: asks billing for an invoice on its queue. */
export const handler = async (event: { month: string }): Promise<void> => {
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.INVOICES_QUEUE_URL, MessageBody: JSON.stringify({ month: event.month }) }));
};
