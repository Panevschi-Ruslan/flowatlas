export interface LoanRequest {
  borrowerId: string;
  itemIds: string[];
}

export const loanIdOf = (request: LoanRequest): string => `${request.borrowerId}-${request.itemIds.join('-')}`;
