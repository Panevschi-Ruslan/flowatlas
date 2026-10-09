import { loansDueBefore } from '../lib/desk-table';
import { measured } from '../lib/wrappers';

async function sendReminders(): Promise<{ sent: number }> {
  const overdue = await loansDueBefore(new Date().toISOString());
  return { sent: overdue.length };
}

// A helper of this repository that hands the function to a package nobody
// installed: read, and no more certain than the package.
export const handler = measured('sendReminders', sendReminders);
