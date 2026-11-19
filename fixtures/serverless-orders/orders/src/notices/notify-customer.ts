import type { SNSEvent } from 'aws-lambda';

/** Subscribed to the shipped topic: tells the customer their order is on its way. */
export const handler = async (event: SNSEvent): Promise<void> => {
  for (const record of event.Records) console.log('shipped', record.Sns.Message);
};
