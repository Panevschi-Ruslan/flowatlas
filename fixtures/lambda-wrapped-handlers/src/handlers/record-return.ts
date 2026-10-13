import { closeLoan } from '../lib/desk-table';
import { withRetry } from '../lib/wrappers';

interface ReturnEvent {
  loanId: string;
}

async function recordReturn(event: ReturnEvent): Promise<{ closed: boolean }> {
  const loan = await closeLoan(event.loanId, new Date().toISOString());
  return { closed: loan !== undefined };
}

// Options, then the function.
export const handler = withRetry({ attempts: 3 }, recordReturn);
