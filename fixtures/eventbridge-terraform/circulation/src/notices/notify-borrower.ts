import type { EventBridgeEvent } from 'aws-lambda';
import type { Loan } from '../lib/loans-table';
import { sendNotice } from '../lib/notices';

type Notified = EventBridgeEvent<'LoanCreated' | 'HoldRequested' | 'ItemReturned', Pick<Loan, 'borrowerId'>>;

/** The target of three rules: a loan made, a hold requested, an item returned. */
export const handler = async (event: Notified): Promise<void> => {
  await sendNotice({ borrowerId: event.detail.borrowerId, subject: event['detail-type'] });
};
