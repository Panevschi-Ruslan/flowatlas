import { useEffect, useState } from 'react';

interface BoardEvent {
  type: string;
  title?: string;
  member?: string;
}

/** The handler of the board's activity, by name. */
export function handleActivity(event: BoardEvent): void {
  if (event.type === 'CARD_ADDED') console.log('card', event.title);
}

/** The handler of the board's presence, by name. */
export function handlePresence(event: BoardEvent): void {
  if (event.type === 'MEMBER_JOINED') console.log('joined', event.member);
}

export function BoardScreen({ boardId }: { boardId: string }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const activity = new EventSource(`${import.meta.env.VITE_GATEWAY_URL}/boards/${boardId}/activity`);
    activity.onmessage = (frame) => handleActivity(JSON.parse(frame.data) as BoardEvent);
    const presence = new EventSource(`${import.meta.env.VITE_GATEWAY_URL}/boards/${boardId}/presence`);
    presence.addEventListener('message', (frame) => handlePresence(JSON.parse(frame.data) as BoardEvent));
    return () => {
      activity.close();
      presence.close();
      setOpen(false);
    };
  }, [boardId]);
  return <p>{open ? 'live' : 'closed'}</p>;
}
