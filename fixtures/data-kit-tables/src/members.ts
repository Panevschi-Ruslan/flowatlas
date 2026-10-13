import { createClient } from '@acme/data-kit';
import { MEMBERS } from './tables';

// A client the kit's factory made, whose methods take the table. The
// configuration names the factory, and each call is followed back to it.
const db = createClient({ pool: 4 });

export const joinLibrary = async (memberId: string, name: string): Promise<void> => {
  await db.insert(MEMBERS, { memberId, name });
};

export const leaveLibrary = async (memberId: string): Promise<void> => {
  await db.remove('members', { memberId });
};

// An object of the repository's own with a method of the same name is not the kit's client.
const outbox = { insert: (table: string, row: unknown): unknown[] => [table, row] };
export const queueWelcome = (memberId: string): unknown[] => outbox.insert('welcome', { memberId });
