/** Test data builders: a second test directory, reported with a row of its own. */
export const anOrder = (total = 10): { total: number } => ({ total });
export const aStatus = (): string => 'new';
