import type { SQSEvent } from 'aws-lambda';
import type { Reminder } from './notify-borrower';

const sent: Reminder[] = [];

/** Reads the reminders queue. */
export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) sent.push(JSON.parse(record.body) as Reminder);
};
