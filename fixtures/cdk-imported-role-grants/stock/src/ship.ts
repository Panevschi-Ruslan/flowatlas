import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({});

const carriers = new Map<string, string>();

/** A shipment onto the queue registered for its carrier. */
export const handler = async (event: { carrier: string; order: string }) => {
  await sqs.send(new SendMessageCommand({ QueueUrl: carriers.get(event.carrier), MessageBody: JSON.stringify(event) }));
};

export const register = (carrier: string, queueUrl: string): void => {
  carriers.set(carrier, queueUrl);
};
