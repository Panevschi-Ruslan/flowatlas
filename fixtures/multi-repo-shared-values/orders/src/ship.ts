import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

const sns = new SNSClient({ region: 'eu-west-1' });
const sqs = new SQSClient({ region: 'eu-west-1' });

/** Ships an order: says so on its own topic, audits it, and alerts the platform. */
export const handler = async (event: { orderId: string }): Promise<void> => {
  await sns.send(new PublishCommand({ TopicArn: process.env.EVENTS_TOPIC_ARN, Message: JSON.stringify({ shipped: event.orderId }) }));
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.AUDIT_QUEUE_URL, MessageBody: JSON.stringify({ orderId: event.orderId }) }));
  await sns.send(new PublishCommand({ TopicArn: process.env.ALERTS_TOPIC_ARN, Message: JSON.stringify({ shipped: event.orderId }) }));
};
