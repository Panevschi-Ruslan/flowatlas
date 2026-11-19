import { emit } from '../common/emit';
import type { events } from '../common/events';

/** Puts again whichever event it is handed by name: a name no caller here writes. */
export const handler = async (event: { name: keyof typeof events; data: Record<string, unknown> }) => {
  await emit(event.name, event.data);
};
