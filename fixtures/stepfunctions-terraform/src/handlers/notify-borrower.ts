import { composeNotice, sendNotice } from '../lib/notices';

interface NotifyEvent {
  borrowerId: string;
  kind: 'approved' | 'renewed' | 'fee-due';
  /** Present when the workflow waits for the borrower to act on the notice. */
  taskToken?: string;
}

export const handler = async (event: NotifyEvent): Promise<void> => {
  await sendNotice(composeNotice(event.borrowerId, event.kind));
};
