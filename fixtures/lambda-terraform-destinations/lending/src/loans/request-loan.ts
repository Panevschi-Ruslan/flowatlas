/** Records a loan request; invoked without waiting, its result goes on to a destination. */
export const handler = async (event: { memberId: string; itemId: string }): Promise<{ loanId: string }> => ({
  loanId: `${event.memberId}-${event.itemId}`,
});
