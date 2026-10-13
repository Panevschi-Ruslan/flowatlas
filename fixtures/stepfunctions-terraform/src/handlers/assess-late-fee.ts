import { lateFee } from '../lib/fees';

interface Overdue {
  borrowerId: string;
  daysOverdue: number;
  replacementCost: number;
}

export const handler = async (event: Overdue): Promise<{ fee: number }> => ({
  fee: lateFee(event.daysOverdue, event.replacementCost),
});
