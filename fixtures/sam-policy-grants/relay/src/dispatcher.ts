import { ListQueuesCommand, SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({});

// Every queue of the account, found once per container.
let queues: Map<string, string> | undefined;

const discover = async (): Promise<Map<string, string>> => {
  const found = new Map<string, string>();
  const listed = await sqs.send(new ListQueuesCommand({}));
  for (const url of listed.QueueUrls ?? []) found.set(url.split('/').pop() ?? url, url);
  return found;
};

/** Each message to the queue named after its kind. */
export const handler = async (event: { kind: string; body: unknown }) => {
  queues ??= await discover();
  const queueUrl = queues.get(event.kind);
  await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(event.body) }));
};
