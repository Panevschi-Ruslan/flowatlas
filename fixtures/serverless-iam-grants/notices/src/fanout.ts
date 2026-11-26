import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({});

const subscribers = new Map<string, string>();

/** A notice to the queue each subscriber registered. */
export const handler = async (event: { subscriber: string; notice: { text: string } }) => {
  await sqs.send(new SendMessageCommand({ QueueUrl: subscribers.get(event.subscriber), MessageBody: JSON.stringify(event.notice) }));
};

export const subscribe = (subscriber: string, queueUrl: string): void => {
  subscribers.set(subscriber, queueUrl);
};
