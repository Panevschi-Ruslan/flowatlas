import { useState } from 'react';
import { useDeskEvents, type DeskEvent } from '../live/useDeskEvents';

let assigned = '';

/** The handler the queue hands the stream: a function of the module, by name. */
export function onQueueEvent(event: DeskEvent): void {
  if (event.type === 'TICKET_ASSIGNED') assigned = event.ticketId;
}

/** The queue the router shows at /queue: it reacts to an assignment. */
export function QueueScreen() {
  const [shown] = useState<string>(assigned);
  useDeskEvents('main', onQueueEvent);
  return <p>{shown}</p>;
}
