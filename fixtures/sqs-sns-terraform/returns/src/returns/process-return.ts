import type { SQSEvent } from 'aws-lambda';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { sqs, type ReturnedItem } from '../lib/returns-queue';

const sns = new SNSClient({ region: 'eu-west-1' });

export interface AuditEntry {
  itemId: string;
  action: 'returned';
}

/**
 * Reads the returns queue through an event-source mapping, announces each
 * return on a topic, and writes an audit entry to a queue whose URL differs
 * between the two environments' variable files.
 */
export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const item = JSON.parse(record.body) as ReturnedItem;
    await sns.send(
      new PublishCommand({
        TopicArn: process.env.ITEM_RETURNED_TOPIC_ARN,
        Message: JSON.stringify(item),
      }),
    );
    const audit: AuditEntry = { itemId: item.itemId, action: 'returned' };
    await sqs.send(new SendMessageCommand({ QueueUrl: process.env.AUDIT_QUEUE_URL, MessageBody: JSON.stringify(audit) }));
  }
};
