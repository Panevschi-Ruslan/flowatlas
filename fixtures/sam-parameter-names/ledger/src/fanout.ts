import { ListQueuesCommand, SendMessageBatchCommand, SQSClient } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({});

interface Batch {
  QueueUrl: string | undefined;
  Entries: { Id: string; MessageBody: string }[];
}

// The queues of each team, found by listing the account once per container.
let teamQueues: Map<string, string> | undefined;

const discover = async (): Promise<Map<string, string>> => {
  const found = new Map<string, string>();
  const listed = await sqs.send(new ListQueuesCommand({ QueueNamePrefix: 'team-' }));
  for (const url of listed.QueueUrls ?? []) found.set(url.split('/').pop() ?? url, url);
  return found;
};

/** Each change to the team its queue is found for, and every change to the audit queue. */
export const handler = async (event: { Records: { eventID: string; kinesis: { data: string } }[] }) => {
  teamQueues ??= await discover();
  const byTeam = new Map<string, Batch>();
  for (const record of event.Records) {
    const change = JSON.parse(Buffer.from(record.kinesis.data, 'base64').toString('utf8')) as { id: string; team: string };
    const queueUrl = teamQueues.get(`team-${change.team}`);
    if (!byTeam.has(change.team)) byTeam.set(change.team, { QueueUrl: queueUrl, Entries: [] });
    byTeam.get(change.team)?.Entries.push({ Id: change.id, MessageBody: JSON.stringify(change) });
  }
  for (const batch of byTeam.values()) {
    await sqs.send(new SendMessageBatchCommand(batch));
  }

  const audit = new Map<string, Batch>();
  audit.set('all', {
    QueueUrl: process.env.AUDIT_QUEUE_URL,
    Entries: event.Records.map((record) => ({ Id: record.eventID, MessageBody: record.kinesis.data })),
  });
  for (const batch of Array.from(audit.values())) {
    await sqs.send(new SendMessageBatchCommand(batch));
  }
};
