import type { SNSEvent } from 'aws-lambda';
import AWS from 'aws-sdk';
import type { ReturnedItem } from '../lib/returns-queue';

export interface Reminder {
  borrowerId: string;
  text: string;
}

const legacySqs = new AWS.SQS({ region: 'eu-west-1' });

/**
 * Subscribed to the topic directly. Queues a thank-you reminder with version 2
 * of the SDK, to a queue named in the code.
 */
export const handler = async (event: SNSEvent): Promise<void> => {
  for (const record of event.Records) {
    const item = JSON.parse(record.Sns.Message) as ReturnedItem;
    const reminder: Reminder = { borrowerId: item.borrowerId, text: 'Thank you for returning your item' };
    await legacySqs
      .sendMessage({
        QueueUrl: 'https://sqs.eu-west-1.amazonaws.com/111122223333/library-reminders',
        MessageBody: JSON.stringify(reminder),
      })
      .promise();
  }
};
