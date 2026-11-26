import type { SNSEvent } from 'aws-lambda';

/** Tells the shop's staff when a product is back in stock. */
export const handler = async (event: SNSEvent): Promise<void> => {
  for (const record of event.Records) {
    const { sku } = JSON.parse(record.Sns.Message) as { sku: string };
    console.log(`back in stock: ${sku}`);
  }
};
