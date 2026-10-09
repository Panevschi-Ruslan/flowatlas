import type { Loan } from '../lib/loans';

export const handler = async (event: Loan): Promise<{ held: string[] }> => ({ held: event.itemIds });
