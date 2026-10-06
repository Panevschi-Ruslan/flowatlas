export const handler = async (event: { loanId: string }): Promise<{ notified: string }> => ({
  notified: event.loanId,
});
