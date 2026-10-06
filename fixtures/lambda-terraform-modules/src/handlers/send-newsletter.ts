import type { ScheduledEvent } from 'aws-lambda';

export const handler = async (event: ScheduledEvent): Promise<void> => {
  console.log(`newsletter for ${event.time}`);
};
