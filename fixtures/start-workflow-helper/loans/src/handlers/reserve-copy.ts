export const handler = async (event: { loanId: string; itemId: string }): Promise<{ reserved: string }> => ({
  reserved: event.itemId,
});
