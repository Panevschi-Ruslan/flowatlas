export interface Hold {
  holdId: string;
  isbn: string;
  borrowerId: string;
  placedOn: string;
  readyUntil?: string;
  status: 'waiting' | 'ready' | 'cancelled' | 'expired';
}

const holds = new Map<string, Hold>();

export const placeHold = async (isbn: string, borrowerId: string): Promise<Hold> => {
  const hold: Hold = {
    holdId: `${isbn}-${borrowerId}`,
    isbn,
    borrowerId,
    placedOn: new Date().toISOString(),
    status: 'waiting',
  };
  holds.set(hold.holdId, hold);
  return hold;
};

export const cancelHold = async (holdId: string): Promise<Hold | undefined> => {
  const hold = holds.get(holdId);
  if (hold === undefined) return undefined;
  const cancelled: Hold = { ...hold, status: 'cancelled' };
  holds.set(holdId, cancelled);
  return cancelled;
};

export const holdsReadyBefore = async (time: string): Promise<Hold[]> =>
  [...holds.values()].filter(
    (hold) => hold.status === 'ready' && hold.readyUntil !== undefined && hold.readyUntil < time,
  );

export const expireHold = async (holdId: string): Promise<void> => {
  const hold = holds.get(holdId);
  if (hold !== undefined) holds.set(holdId, { ...hold, status: 'expired' });
};
