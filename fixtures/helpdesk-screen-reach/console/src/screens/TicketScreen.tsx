import { useState } from 'react';
import { useDeskEvents, type DeskEvent } from '../live/useDeskEvents';

let state = 'open';

/** One ticket's handler: an assignment and a close, told apart by `type`. */
export function onTicketEvent(event: DeskEvent): void {
  if (event.type === 'TICKET_ASSIGNED') state = 'assigned';
  else if (event.type === 'TICKET_CLOSED') state = 'closed';
}

/** One ticket, shown at /tickets/:ticketId. */
export function TicketScreen() {
  const [shown] = useState<string>(state);
  useDeskEvents('main', onTicketEvent);
  return <p>{shown}</p>;
}
