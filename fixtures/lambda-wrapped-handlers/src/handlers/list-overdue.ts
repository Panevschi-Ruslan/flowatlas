import { cachedOverdue, loansDueBefore, type Loan } from '../lib/desk-table';
import { firstOf } from '../lib/wrappers';

async function fromCache(): Promise<Loan[] | undefined> {
  return cachedOverdue();
}

async function fromTable(): Promise<Loan[]> {
  return loansDueBefore(new Date().toISOString());
}

// Two functions handed over: which of them answers is not in the call, so this
// is a wrapper of neither and stays a row.
export const handler = firstOf(fromCache, fromTable);
