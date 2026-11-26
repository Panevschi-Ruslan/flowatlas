import { useEffect, useState } from 'react';

import { boardFeed } from '../live/board-feed';

/** The types that make the board refetch: a constant set the callback tests the type against. */
const REFRESH_ON: ReadonlySet<string> = new Set(['CARD_MOVED', 'CARD_ARCHIVED', 'CARD_PINNED', 'CARD_IMPORTED']);

export function BoardScreen({ boardId }: { boardId: string }) {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    boardFeed.connect(boardId);
    const sub = boardFeed.events$.subscribe((evt) => {
      if (REFRESH_ON.has(evt.type)) setVersion(Date.now());
    });
    return () => sub.unsubscribe();
  }, [boardId]);

  return <main data-version={version} />;
}
