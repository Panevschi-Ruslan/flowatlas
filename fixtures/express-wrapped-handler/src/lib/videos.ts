/** What the handlers reach, so a body that was read has somewhere to go. */
export const loadVideo = async (id: string): Promise<{ id: string }> => ({ id });

export const saveVideo = async (name: string): Promise<{ id: string }> => ({ id: name });

export const countRates = async (id: string, kind: string): Promise<number> =>
  id.length + kind.length;
