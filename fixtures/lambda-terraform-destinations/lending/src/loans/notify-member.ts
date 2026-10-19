/** Tells a member their loan went through: the success destination of request-loan. */
export const handler = async (event: { responsePayload: { loanId: string } }): Promise<void> => {
  console.log('loan', event.responsePayload.loanId);
};
