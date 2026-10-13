import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { events, LIBRARY_BUS_ARN } from '../events/client';
import { publishEvent } from '../events/publish';

export interface Hold {
  holdId: string;
  borrowerId: string;
  itemId: string;
  position: number;
}

/**
 * A command built in a local and sent a statement later, carrying two entries.
 *
 * Each entry is an event of its own: the first names no bus and goes to the
 * account's default one; the second names the library's bus by its ARN.
 */
export const publishHoldPlaced = async (hold: Hold): Promise<void> => {
  const command = new PutEventsCommand({
    Entries: [
      { Source: 'library.holds', DetailType: 'HoldPlaced', Detail: JSON.stringify(hold) },
      {
        EventBusName: LIBRARY_BUS_ARN,
        Source: 'library.holds',
        DetailType: 'HoldQueued',
        Detail: JSON.stringify({ holdId: hold.holdId, position: hold.position }),
      },
    ],
  });
  await events.send(command);
};

/** Sent through the project's own helper function, described in configuration. */
export const publishHoldCancelled = async (hold: Hold): Promise<void> => {
  await publishEvent(
    new PutEventsCommand({
      Entries: [
        { EventBusName: 'library-events', Source: 'library.holds', DetailType: 'HoldCancelled', Detail: JSON.stringify(hold) },
      ],
    }),
  );
};
