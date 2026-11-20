export type Transport = 'hub' | 'worker';

const HUB_ONLY: ReadonlySet<Transport> = new Set<Transport>(['hub']);
const WORKER_ONLY: ReadonlySet<Transport> = new Set<Transport>(['worker']);
const HUB_AND_WORKER: ReadonlySet<Transport> = new Set<Transport>(['hub', 'worker']);

/** Where each family of channel goes. A family not listed goes to the hub alone. */
const ROUTES: ReadonlyMap<string, ReadonlySet<Transport>> = new Map([
  ['board:*:events', HUB_ONLY],
  ['crew:*:shifts', HUB_AND_WORKER],
  ['board:*:audit', WORKER_ONLY],
  ['board:*:orders', WORKER_ONLY],
]);

/** A channel's family: what names one board or crew stands as `*`. */
const familyOf = (channel: string): string => channel.replace(/^(\w+):[^:]+:/, '$1:*:');

export const resolveTransports = (channel: string): ReadonlySet<Transport> => ROUTES.get(familyOf(channel)) ?? HUB_ONLY;
