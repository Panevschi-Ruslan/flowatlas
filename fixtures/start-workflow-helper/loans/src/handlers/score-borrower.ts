export const handler = async (event: { borrowerId: string }): Promise<{ score: number }> => ({
  score: event.borrowerId.length,
});
