import { scoreOf, type Borrower } from '../lib/standing';

export const handler = async (event: Borrower): Promise<{ score: number }> => ({
  score: scoreOf(event),
});
