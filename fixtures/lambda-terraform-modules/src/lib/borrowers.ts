export interface Borrower {
  borrowerId: string;
  name: string;
}

const borrowers = new Map<string, Borrower>();

export const registerBorrower = async (borrower: Borrower): Promise<Borrower> => {
  borrowers.set(borrower.borrowerId, borrower);
  return borrower;
};

export const findBorrower = async (borrowerId: string): Promise<Borrower | undefined> => borrowers.get(borrowerId);
