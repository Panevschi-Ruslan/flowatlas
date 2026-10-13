import { findOne, insert } from '@acme/data-kit';
import * as kit from '@acme/data-kit';
import { auditLog } from './audit';
import { LOANS, MEMBERS } from './tables';

export interface Loan {
  loanId: string;
  memberId: string;
  isbn: string;
}

// The table is a constant of the repository's own, read through the import.
export const lendBook = async (memberId: string, isbn: string): Promise<Loan> => {
  const member = await findOne(MEMBERS, { memberId });
  if (member === undefined) throw new Error('no such member');
  const loan: Loan = { loanId: `${memberId}:${isbn}`, memberId, isbn };
  await insert(LOANS, loan);
  await auditLog('lent', loan.loanId);
  return loan;
};

// Reached through a namespace import of the kit, the table written in place.
export const returnBook = async (loanId: string): Promise<void> => {
  await kit.remove('loans', { loanId });
  await auditLog('returned', loanId);
};

// The table is worked out at run time: the query is kept, and a row says
// which argument would name it.
export const archive = async (year: number, loan: Loan): Promise<void> => {
  await insert(`loans_${year}`, loan);
};

// A function of the same name that is not the kit's is not a query.
const findOneLocal = (table: string): string => table;
export const lookalike = (): string => {
  const findOne = findOneLocal;
  return findOne('members');
};
