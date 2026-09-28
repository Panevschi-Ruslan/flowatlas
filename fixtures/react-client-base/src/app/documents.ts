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

/**
 * A call that spells its own base, and one that spells one nobody can read.
 *
 * The first is a wiki app's shape exactly: the route this means is mounted
 * somewhere else, the call says which base it wants, and recording it under the
 * client's `/api` put it at an address nothing serves (R128). The second writes
 * the same option with a value nothing static settles — so the address keeps the
 * path that was read, the client's default is *not* used behind it, and a row
 * names the line.
 */
export const registerPasskey = (id: string): Promise<unknown> =>
  client.post('/passkeys.generateRegistrationOptions', { id }, { baseUrl: '/auth' });

export const verifyPasskey = (id: string, where: string): Promise<unknown> =>
  client.post('/passkeys.verify', { id }, { baseUrl: where });
