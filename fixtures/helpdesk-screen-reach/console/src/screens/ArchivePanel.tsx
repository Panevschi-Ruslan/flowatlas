import { useState } from 'react';
import { useDeskEvents, type DeskEvent } from '../live/useDeskEvents';

let reopened = '';

/** The panel's handler: it selects a reopen. */
export function onArchiveEvent(event: DeskEvent): void {
  if (event.type === 'TICKET_REOPENED') reopened = event.ticketId;
}

/** A panel no route shows and nothing renders: no way in reaches its handler. */
export function ArchivePanel() {
  const [shown] = useState<string>(reopened);
  useDeskEvents('main', onArchiveEvent);
  return <p>{shown}</p>;
}
