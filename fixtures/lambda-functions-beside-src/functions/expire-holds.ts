import type { ScheduledEvent } from 'aws-lambda';
import { expireHold, holdsReadyBefore } from '../src/holds/holds-table';
import { tellBorrowerHoldLapsed } from '../src/notices/notices';

export const handler = async (event: ScheduledEvent): Promise<void> => {
  for (const hold of await holdsReadyBefore(event.time)) {
    await expireHold(hold.holdId);
    await tellBorrowerHoldLapsed(hold.borrowerId, hold.isbn);
  }
};
