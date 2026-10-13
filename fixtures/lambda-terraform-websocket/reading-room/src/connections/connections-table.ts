const open = new Set<string>();

export const remember = async (connectionId: string): Promise<void> => {
  open.add(connectionId);
};

export const forget = async (connectionId: string): Promise<void> => {
  open.delete(connectionId);
};
