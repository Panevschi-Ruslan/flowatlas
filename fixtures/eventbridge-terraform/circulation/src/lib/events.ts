import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

export const events = new EventBridgeClient({ region: 'eu-west-1' });

/** The bus every circulation event is put on. */
export const LIBRARY_BUS = 'library';

/**
 * The project's own helper for what returns publish: each caller names the
 * detail type and hands over the detail, and the helper fills in the bus and
 * the source. Its own `send` cannot say which event it puts - the caller
 * decides - which is why it is described in `flowatlas.config.json`.
 */
export const publishLibraryEvent = async (detailType: string, detail: unknown): Promise<void> => {
  await events.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: LIBRARY_BUS,
          Source: 'library.returns',
          DetailType: detailType,
          Detail: JSON.stringify(detail),
        },
      ],
    }),
  );
};
