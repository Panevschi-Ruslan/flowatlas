import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { events } from './events';

const bus = new EventBridgeClient({});

/** Puts the event of this name on the bus, built by its factory from `data`. */
export async function emit(name: keyof typeof events, data: Record<string, unknown>) {
  const entry = events[name](data);
  const command = new PutEventsCommand({ Entries: [entry] });
  return bus.send(command);
}

/** Puts an entry built somewhere else on the bus as it is. */
export const putEntry = async (entry: ReturnType<typeof events.OrderPlaced>) => bus.send(new PutEventsCommand({ Entries: [entry] }));
