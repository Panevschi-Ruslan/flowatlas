import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { events } from './client';

/** An event of the library's own, the way a project wraps the SDK once. */
export class LibraryEvent<T> {
  constructor(readonly init: { type: string; detail: T }) {}
}

/**
 * The project's helper around `PutEvents`.
 *
 * Its own call to the SDK names the detail type with whatever it was handed,
 * so read from here it has no channel. The configuration describes the helper
 * instead, and each call of it names its channel at the call.
 */
export class LibraryEventBus {
  async put<T>(event: LibraryEvent<T>): Promise<void> {
    await events.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: 'library-events',
            Source: 'library.returns',
            DetailType: event.init.type,
            Detail: JSON.stringify(event.init.detail),
          },
        ],
      }),
    );
  }
}

export const libraryEvents = new LibraryEventBus();
