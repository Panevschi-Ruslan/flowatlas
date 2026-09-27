import { client } from './api-client';

/**
 * The requests, each written as the tail of an address and nothing more.
 *
 * Two of them are answered by a route of this repository, under the segment the
 * client holds. The third names a host of its own, and is here to keep the base
 * from being put in front of an address that was never relative to it.
 */
export const readDocument = (id: string): Promise<unknown> =>
  client.post('/documents.info', { id });

export const renameDocument = (id: string, title: string): Promise<unknown> =>
  client.post('/documents.update', { id, title });

/** Somebody else's service, named outright. The client's base is not its base. */
export const reportOpened = (id: string): Promise<unknown> =>
  client.post('https://telemetry.example.com/events', { id });
