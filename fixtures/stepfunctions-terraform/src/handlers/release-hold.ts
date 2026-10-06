interface ExpiredHold {
  holdId: string;
  itemId: string;
}

const nextInQueue = (hold: ExpiredHold): string => `${hold.itemId}#next`;

export const handler = async (event: ExpiredHold): Promise<{ offeredTo: string }> => ({
  offeredTo: nextInQueue(event),
});
