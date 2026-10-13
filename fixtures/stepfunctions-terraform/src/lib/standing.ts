export type Standing = 'good' | 'suspended' | 'overdue';

export interface Borrower {
  borrowerId: string;
  overdueItems: number;
  unpaidFees: number;
}

/** A borrower with unpaid fees is suspended; one with overdue items is overdue. */
export const standingOf = (borrower: Borrower): Standing => {
  if (borrower.unpaidFees > 0) return 'suspended';
  return borrower.overdueItems > 0 ? 'overdue' : 'good';
};

/** A score between 0 and 100 the librarian sees beside an application. */
export const scoreOf = (borrower: Borrower): number =>
  Math.max(0, 100 - borrower.overdueItems * 15 - Math.min(borrower.unpaidFees, 50));
