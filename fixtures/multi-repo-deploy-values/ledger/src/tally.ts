import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';

const sns = new SNSClient({ region: 'eu-west-1' });

/** Tallies the platform's clicks, a batch of records at a time, and alerts the platform on a large one. */
export const handler = async (event: { Records: unknown[] }): Promise<number> => {
  if (event.Records.length > 100) await sns.send(new PublishCommand({ TopicArn: process.env.ALERTS_TOPIC_ARN, Message: JSON.stringify({ clicks: event.Records.length }) }));
  return event.Records.length;
};
