import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({ region: 'eu-west-1' });

/** POST /jobs: queues the job for the shared service's worker. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.JOBS_QUEUE_URL, MessageBody: event.body ?? '{}' }));
  return { statusCode: 202, body: '' };
};
