import type { SQSEvent } from 'aws-lambda';

const shelved: string[] = [];

/** Reads the returns queue POST /returns sends the request to, with no function in between. */
export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const { itemId } = JSON.parse(record.body) as { itemId: string };
    shelved.push(itemId);
  }
};
