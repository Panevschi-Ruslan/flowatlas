import { findLoan } from '../lib/loans-table';

export interface Review {
  loanId: string;
  approved: boolean;
}

/** Invoked by the loan-review state machine, which a rule starts. */
export const handler = async (input: { loanId: string }): Promise<Review> => {
  const loan = await findLoan(input.loanId);
  return { loanId: input.loanId, approved: loan !== undefined && loan.renewals < 5 };
};
