import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({});

const reasons = new Map<string, string>();

/** A stock move onto the queue registered for its reason. */
export const handler = async (event: { reason: string; sku: string; quantity: number }) => {
  await sqs.send(new SendMessageCommand({ QueueUrl: reasons.get(event.reason), MessageBody: JSON.stringify(event) }));
};

export const register = (reason: string, queueUrl: string): void => {
  reasons.set(reason, queueUrl);
};
