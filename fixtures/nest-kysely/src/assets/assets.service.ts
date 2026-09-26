import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';

import type { DB } from './schema.js';

/** The table named once, to show that a constant is followed like a literal. */
const ASSET = 'asset';

@Injectable()
export class AssetsService {
  constructor(private readonly db: Kysely<DB>) {}

  // A read. The table is the first argument of the call that starts the query,
  // and every call after it describes what that one query will ask for.
  findAll(): Promise<unknown[]> {
    return this.db.selectFrom('asset').selectAll().orderBy('id').execute();
  }

  // The same read written with an alias, which is local to the query. Reading
  // the whole string would put `asset`, `asset as a` and `asset AS a` in the
  // graph as three tables.
  joined(): Promise<unknown[]> {
    return this.db
      .selectFrom('asset as a')
      .innerJoin('asset_exif', 'a.id', 'asset_exif.assetId')
      .selectAll()
      .execute();
  }

  // A read whose table is a constant rather than a literal.
  byOwner(ownerId: string): Promise<unknown[]> {
    return this.db.selectFrom(ASSET).where('ownerId', '=', ownerId).execute();
  }

  // A write.
  create(id: string): Promise<unknown[]> {
    return this.db.insertInto('asset').values({ id }).returningAll().execute();
  }

  // A write on a second table, so the fixture has more than one table node.
  upsertExif(assetId: string, make: string): Promise<unknown[]> {
    return this.db
      .insertInto('asset_exif')
      .values({ assetId, make })
      .onConflict((builder) => builder)
      .execute();
  }

  rename(id: string, type: string): Promise<unknown[]> {
    return this.db.updateTable('asset').set({ type }).where('id', '=', id).execute();
  }

  remove(id: string): Promise<unknown[]> {
    return this.db.deleteFrom('asset_metadata').where('assetId', '=', id).execute();
  }

  // Inside a transaction the receiver is the library's own `Transaction`, which
  // is a `Kysely` by another name, so the same descriptor reads it.
  move(id: string): Promise<unknown> {
    return this.db.transaction().execute(async (tx) => {
      await tx.deleteFrom('asset_metadata').where('assetId', '=', id).execute();
      return tx.insertInto('asset_metadata').values({ assetId: id }).execute();
    });
  }

  // A read whose source is another query rather than a stored table. Real, and
  // unreadable on purpose: immich builds a fifth of its reads this way.
  // Expected: the query is still a node, with no table and a
  // `dynamic-table-name` row saying why. In particular the name of the schema
  // type must not appear as a table here, which is what the tool did before the
  // descriptor existed — on immich it put `DB` on 407 nodes.
  fromSubquery(): Promise<unknown[]> {
    return this.db
      .selectFrom((eb) => eb.selectFrom('asset').selectAll().as('recent'))
      .selectAll()
      .execute();
  }

  // Not a query at all. A method the descriptor does not list is counted as
  // what it is rather than emitted as a second visit to the database.
  close(): Promise<void> {
    return this.db.destroy();
  }
}
