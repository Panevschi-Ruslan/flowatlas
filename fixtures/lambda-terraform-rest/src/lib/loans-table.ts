export interface Loan {
  loanId: string;
  borrowerId: string;
  isbn: string;
  dueOn: string;
  returnedOn?: string;
}

const loans = new Map<string, Loan>();

export const saveLoan = async (loan: Loan): Promise<Loan> => {
  loans.set(loan.loanId, loan);
  return loan;
};

export const findLoan = async (loanId: string): Promise<Loan | undefined> => loans.get(loanId);

export const extendLoan = async (loanId: string, days: number): Promise<Loan | undefined> => {
  const loan = loans.get(loanId);
  if (loan === undefined) return undefined;
  const due = new Date(loan.dueOn);
  due.setDate(due.getDate() + days);
  const renewed = { ...loan, dueOn: due.toISOString() };
  loans.set(loanId, renewed);
  return renewed;
};

export const closeLoan = async (loanId: string, returnedOn: string): Promise<Loan | undefined> => {
  const loan = loans.get(loanId);
  if (loan === undefined) return undefined;
  const closed = { ...loan, returnedOn };
  loans.set(loanId, closed);
  return closed;
};

export const loansDueBefore = async (date: string): Promise<Loan[]> =>
  [...loans.values()].filter((loan) => loan.returnedOn === undefined && loan.dueOn < date);
