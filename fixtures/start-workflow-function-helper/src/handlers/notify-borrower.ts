export const handler = async (event: { borrowerId: string }): Promise<{ notified: string }> => ({
  notified: event.borrowerId,
});
