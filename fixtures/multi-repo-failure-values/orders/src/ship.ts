import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

const sns = new SNSClient({ region: 'eu-west-1' });
const sqs = new SQSClient({ region: 'eu-west-1' });

/** Ships an order: hands the platform a job for it, and alerts the platform when it is late. */
export const handler = async (event: { id: string; late?: boolean }): Promise<void> => {
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.JOBS_QUEUE_URL, MessageBody: JSON.stringify(event) }));
  if (event.late === true) await sns.send(new PublishCommand({ TopicArn: process.env.ALERTS_TOPIC_ARN, Message: event.id }));
};
