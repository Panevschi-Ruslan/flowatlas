import type { SNSEvent } from 'aws-lambda';

/** Subscribed to a mailbox's topic. */
export const handler = async (event: SNSEvent): Promise<void> => {
  for (const record of event.Records) console.log('mail', record.Sns.Message);
};
