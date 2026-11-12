import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';

const sns = new SNSClient({});

/** A notice to whichever topic the caller names. */
export const handler = async (event: { topicArn: string; notice: { text: string } }) => {
  const topics = new Map<string, string>();
  topics.set('chosen', event.topicArn);
  await sns.send(new PublishCommand({ TopicArn: topics.get(event.notice.text), Message: JSON.stringify(event.notice) }));
};
