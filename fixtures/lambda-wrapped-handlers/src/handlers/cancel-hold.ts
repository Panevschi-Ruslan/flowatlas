import { withSpan } from '@lending/tracing';
import { dropHold } from '../lib/desk-table';

interface CancelHoldEvent {
  isbn: string;
  borrowerId: string;
}

async function cancelHold(event: CancelHoldEvent): Promise<void> {
  await dropHold(event.isbn, event.borrowerId);
}

// A name, then the function, from a package that is installed and says it
// hands back a function of the same shape.
export const handler = withSpan('cancelHold', cancelHold);
