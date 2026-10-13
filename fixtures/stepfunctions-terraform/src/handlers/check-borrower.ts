import { standingOf, type Borrower, type Standing } from '../lib/standing';

export const handler = async (event: Borrower): Promise<{ standing: Standing }> => ({
  standing: standingOf(event),
});
