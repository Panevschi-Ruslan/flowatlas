import { useState } from 'react';
import { useWorkspaceEvents, type WorkspaceEvent } from '../live/useWorkspaceEvents';

/** The handler the board hands the hook: a function of the module, by name. */
export function handleParcelEvent(event: WorkspaceEvent): void {
  if (event.type === 'PARCEL_PACKED') console.log('packed', event.parcelId);
}

export function ParcelBoard({ workspaceId }: { workspaceId: string }) {
  useWorkspaceEvents(workspaceId, handleParcelEvent);
  return <ul />;
}

/** A second screen on the same stream, with its handler written in place. */
export function CourierPanel({ workspaceId }: { workspaceId: string }) {
  const [last, setLast] = useState<string>('');
  useWorkspaceEvents(workspaceId, (event) => {
    if (event.type === 'COURIER_ASSIGNED') setLast(event.courierId ?? '');
  });
  return <p>{last}</p>;
}
