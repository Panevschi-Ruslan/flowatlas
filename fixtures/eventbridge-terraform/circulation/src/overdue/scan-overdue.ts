import type { ScheduledEvent } from 'aws-lambda';
import { overdueLoans } from '../lib/loans-table';
import { sendNotice } from '../lib/notices';

/** Run every night by a schedule: nothing publishes to it. */
export const handler = async (event: ScheduledEvent): Promise<void> => {
  for (const loan of await overdueLoans(event.time.slice(0, 10))) {
    await sendNotice({ borrowerId: loan.borrowerId, subject: 'Overdue' });
  }
};
