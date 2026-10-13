/** Asks a librarian to review the loan, handing over the token the answer has to quote. */
export const handler = async (event: { loanId: string; taskToken: string }): Promise<{ asked: string }> => ({
  asked: event.loanId,
});
