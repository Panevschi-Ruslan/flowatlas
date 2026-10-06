import type { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { events } from './client';

/**
 * The other ordinary wrapper: a function that sends whatever command it is
 * handed. Read from here it publishes to a channel it cannot name, because the
 * command was built by its caller; the configuration describes it as a
 * function, and each call of it names its channel at the call.
 */
export const publishEvent = async (command: PutEventsCommand): Promise<void> => {
  await events.send(command);
};
