export interface Loan {
  loanId: string;
  borrowerId: string;
  isbn: string;
  dueOn: string;
}

const loans = new Map<string, Loan>();

export const saveLoan = async (loan: Loan): Promise<Loan> => {
  loans.set(loan.loanId, loan);
  return loan;
};

export const findLoan = async (loanId: string): Promise<Loan | undefined> => loans.get(loanId);

export const loansOf = async (borrowerId: string): Promise<Loan[]> =>
  [...loans.values()].filter((loan) => loan.borrowerId === borrowerId);
