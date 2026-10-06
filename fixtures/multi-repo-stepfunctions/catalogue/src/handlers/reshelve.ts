const shelfOf = (copyId: string): string => copyId.split('-')[0] ?? 'returns';

export const handler = async (event: { copyId: string }): Promise<{ shelf: string }> => ({
  shelf: shelfOf(event.copyId),
});
