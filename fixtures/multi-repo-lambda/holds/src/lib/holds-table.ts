export interface Hold {
  holdId: string;
  borrowerId: string;
  isbn: string;
}

const holds = new Map<string, Hold>();

export const placeHold = async (hold: Hold): Promise<Hold> => {
  holds.set(hold.holdId, hold);
  return hold;
};

export const removeHold = async (holdId: string): Promise<boolean> => holds.delete(holdId);
