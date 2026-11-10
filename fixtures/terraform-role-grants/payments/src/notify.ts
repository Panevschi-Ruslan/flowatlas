import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';

const sns = new SNSClient({});

const topics = new Map<string, string>();

/** A notice to the topic registered for its audience. */
export const handler = async (event: { audience: string; text: string }) => {
  await sns.send(new PublishCommand({ TopicArn: topics.get(event.audience), Message: event.text }));
};

export const register = (audience: string, topicArn: string): void => {
  topics.set(audience, topicArn);
};
