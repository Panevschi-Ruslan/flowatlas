import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({ region: 'eu-west-1' });

/** Puts a notice in the inbox, a queue whose name CloudFormation chooses. */
export const handler = async (notice: { to: string }): Promise<{ paid: boolean }> => {
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.INBOX_URL, MessageBody: JSON.stringify(notice) }));
  return { paid: false };
};
