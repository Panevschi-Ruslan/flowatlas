import type { SNSEvent } from 'aws-lambda';

/** A product is back in stock: the orders waiting on it can be filled. */
export const handler = async (event: SNSEvent): Promise<number> => event.Records.length;
