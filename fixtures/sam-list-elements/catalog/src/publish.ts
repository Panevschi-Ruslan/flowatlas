import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({});

const BASE = 'https://sqs.eu-west-1.amazonaws.com/123456789012';
const SEARCH = `${BASE}/catalog-search`;
const PRICES = `${BASE}/catalog-prices`;

// Who hears of a product's change, by what they keep of it.
const listeners = new Map([
  ['search', SEARCH],
  ['prices', PRICES],
]);
listeners.set('feed', `${BASE}/catalog-feed`);

/** A changed product to the search index and the price list, then to every listener. */
export const handler = async (event: { product: { sku: string } }) => {
  for (const queueUrl of [SEARCH, PRICES]) {
    await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(event.product) }));
  }
  for (const queueUrl of listeners.values()) {
    await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(event.product) }));
  }
};
