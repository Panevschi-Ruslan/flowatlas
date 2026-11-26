import { useEffect } from 'react';

export interface DeskEvent {
  type: string;
  ticketId: string;
  agentId?: string;
}

/**
 * The hook every screen opens the desk's stream through. The address is read
 * here; the function the frames go to is the one each caller hands in.
 */
export function useDeskEvents(deskId: string, onEvent: (event: DeskEvent) => void): void {
  useEffect(() => {
    const source = new EventSource(`${import.meta.env.VITE_DESK_URL}/desks/${deskId}/events`);
    source.onmessage = (frame) => onEvent(JSON.parse(frame.data) as DeskEvent);
    return () => source.close();
  }, [deskId]);
}
