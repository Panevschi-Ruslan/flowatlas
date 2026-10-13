import type { EventBridgeEvent } from 'aws-lambda';
import { deliver } from './outbox';

interface LoanDetail {
  loanId: string;
  borrowerId: string;
}

/** Targeted by a rule another repository declares, by this function's deployed name. */
export const handler = async (event: EventBridgeEvent<'LoanCreated', LoanDetail>): Promise<void> => {
  await deliver(event.detail.borrowerId, 'Welcome to the library');
};
