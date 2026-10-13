export interface LoanRequest {
  borrowerId: string;
  itemIds: string[];
}

export interface Loan extends LoanRequest {
  loanId: string;
  requestedAt: string;
}

export const newLoan = (request: LoanRequest): Loan => ({
  ...request,
  loanId: `${request.borrowerId}-${request.itemIds.join('-')}`,
  requestedAt: new Date().toISOString(),
});
