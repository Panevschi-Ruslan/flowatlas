import { composeNotice, sendNotice } from '../lib/notices';

export const handler = async (event: { borrowerId: string }): Promise<void> => {
  await sendNotice(composeNotice(event.borrowerId, 'overdue'));
};
