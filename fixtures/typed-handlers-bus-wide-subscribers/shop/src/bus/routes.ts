export type Transport = 'process' | 'bot';

const IN_PROCESS: ReadonlySet<Transport> = new Set<Transport>(['process']);
const IN_PROCESS_AND_BOT: ReadonlySet<Transport> = new Set<Transport>(['process', 'bot']);

/** Where each channel goes besides the process itself. A channel not listed stays in the process. */
const ROUTES: ReadonlyMap<string, ReadonlySet<Transport>> = new Map([
  ['order_updates', IN_PROCESS_AND_BOT],
  ['desk_alerts', IN_PROCESS],
]);

export const transportsFor = (channel: string): ReadonlySet<Transport> => ROUTES.get(channel) ?? IN_PROCESS;
