import { Injectable } from '@nestjs/common';
import type { Db } from 'mongodb';

/** Migrations written against the driver directly, the way most are. */
@Injectable()
export class Migrations {
  // The collection is named in the chain: `floor_decorations`, delete.
  dropDecorations(db: Db): Promise<boolean> {
    return db.collection('floor_decorations').drop();
  }

  // The collection is kept in a constant first: `users`, write.
  backfillUsers(db: Db): Promise<unknown> {
    const users = db.collection('users');
    return users.updateMany({}, { $set: { active: true } });
  }

  // Decided at run time: a query with no table, and a row saying so.
  purge(db: Db, name: string): Promise<unknown> {
    return db.collection(name).deleteOne({});
  }
}
