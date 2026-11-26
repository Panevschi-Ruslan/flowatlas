import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({});

const outcomes = new Map<string, string>();

/** A payment onto the queue registered for its outcome. */
export const handler = async (event: { outcome: string; payment: { id: string } }) => {
  await sqs.send(new SendMessageCommand({ QueueUrl: outcomes.get(event.outcome), MessageBody: JSON.stringify(event.payment) }));
};

export const register = (outcome: string, queueUrl: string): void => {
  outcomes.set(outcome, queueUrl);
};
