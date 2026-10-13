import AWS from 'aws-sdk';

/**
 * A function still on version 2 of the SDK: one package for every service, the
 * input handed straight to the method, and `promise()` on what comes back.
 */
const sqs = new AWS.SQS({ region: 'eu-west-1' });

export interface Reminder {
  borrowerId: string;
  itemId: string;
  dueOn: string;
}

export const handler = async (reminder: Reminder): Promise<void> => {
  await sqs
    .sendMessage({
      QueueUrl: 'https://sqs.eu-west-1.amazonaws.com/111122223333/library-reminders',
      MessageBody: JSON.stringify(reminder),
    })
    .promise();
};
