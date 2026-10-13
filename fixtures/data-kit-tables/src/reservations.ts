import { createClient, type DataClient } from '@acme/data-kit';
import type * as kit from '@acme/data-kit';

// A client handed in rather than made here: a constructor's injected field
// typed by the name the kit gives it, and a parameter typed by what the
// factory returns. Each is followed by its declared type (P44).
export class Reservations {
  constructor(private readonly db: DataClient) {}

  async hold(isbn: string, memberId: string): Promise<void> {
    await this.db.insert('reservations', { isbn, memberId });
  }
}

export const releaseHold = async (db: ReturnType<typeof createClient>, isbn: string): Promise<void> => {
  await db.remove('reservations', { isbn });
};

// The kit's client named through a namespace import: `kit.DataClient` (P49).
export const extendHold = async (db: kit.DataClient, isbn: string): Promise<void> => {
  await db.insert('hold_extensions', { isbn });
};

// A parameter with a method of the same name, typed as something else, is not the kit's client.
export const notifyHold = (mailer: { insert(queue: string, row: unknown): void }, isbn: string): void => {
  mailer.insert('hold-notices', { isbn });
};

export const reservations = new Reservations(createClient({ pool: 2 }));
