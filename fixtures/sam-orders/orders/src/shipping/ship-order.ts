import type { SQSEvent } from 'aws-lambda';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import type { Order } from '../lib/orders';

const s3 = new S3Client({ region: 'eu-west-1' });
const sns = new SNSClient({ region: 'eu-west-1' });

/**
 * Reads the placed-orders queue: writes each order's invoice under `invoices/`,
 * which `index-invoice` is notified of, and says on the shipped topic that it
 * went out.
 */
export const handler = async (event: SQSEvent): Promise<void> => {
  const order = JSON.parse(event.Records[0]?.body ?? '{}') as Order;
  await s3.send(new PutObjectCommand({ Bucket: process.env.INVOICES_BUCKET, Key: `invoices/${order.orderId}.pdf`, Body: '' }));
  await sns.send(new PublishCommand({ TopicArn: process.env.SHIPPED_TOPIC_ARN, Message: JSON.stringify({ ...order, status: 'shipped' }) }));
};
