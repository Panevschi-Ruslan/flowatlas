import type { ScheduledEvent } from 'aws-lambda';
import { loansDueBefore } from '../lib/loans-table';
import { sendNotice } from '../lib/notices';

export const handler = async (event: ScheduledEvent): Promise<void> => {
  const channel = String(event.detail['channel'] ?? 'email');
  for (const loan of await loansDueBefore(event.time)) {
    await sendNotice(loan.borrowerId, channel, `${loan.isbn} was due on ${loan.dueOn}`);
  }
};
