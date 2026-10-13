import type { SQSEvent } from 'aws-lambda';
import { deliver } from './outbox';

/** Reads the digest queue another repository's rules send to. */
export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const { borrowerId } = JSON.parse(record.body) as { borrowerId: string };
    await deliver(borrowerId, 'Your loans this week');
  }
};
