export interface Loan {
  loanId: string;
  borrowerId: string;
  itemId: string;
  dueOn: string;
  renewals: number;
}

const loans = new Map<string, Loan>();

export const saveLoan = async (loan: Loan): Promise<void> => {
  loans.set(loan.loanId, loan);
};

export const findLoan = async (loanId: string): Promise<Loan | undefined> => loans.get(loanId);

export const overdueLoans = async (today: string): Promise<Loan[]> =>
  [...loans.values()].filter((loan) => loan.dueOn < today);
