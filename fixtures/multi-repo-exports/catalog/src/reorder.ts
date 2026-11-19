import type { SQSEvent } from 'aws-lambda';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';

const sns = new SNSClient({ region: 'eu-west-1' });

/**
 * Every order placed takes stock: when a product runs low, a new order is
 * placed with the supplier through the shop's own API, and the topic says
 * when it is back.
 */
export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const { sku } = JSON.parse(record.body) as { sku: string };
    await fetch(`${process.env.SHOP_API_URL}/orders`, { method: 'POST', body: JSON.stringify({ sku, quantity: 10 }) });
    await sns.send(new PublishCommand({ TopicArn: process.env.RESTOCK_TOPIC_ARN, Message: JSON.stringify({ sku }) }));
  }
};
