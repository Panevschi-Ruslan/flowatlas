import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';

import type { DB } from './schema.js';

/**
 * A data layer whose library is not installed.
 *
 * `kysely` is a dependency of this fixture and there is no `node_modules/kysely`
 * beside it on purpose, so the checker cannot resolve the connection's type -
 * exactly the state a stranger's clone is in. What the file still says, in plain
 * sight, is that `db` is a `Kysely` and that `Kysely` came from `kysely`, and
 * that is the whole of what the descriptor needed.
 */
@Injectable()
export class AssetsService {
  constructor(private readonly db: Kysely<DB>) {}

  findAll(): Promise<unknown[]> {
    return this.db.selectFrom('asset').selectAll().execute();
  }

  create(id: string): Promise<unknown[]> {
    return this.db.insertInto('asset').values({ id }).execute();
  }

  remove(id: string): Promise<unknown[]> {
    return this.db.deleteFrom('asset_face').where('assetId', '=', id).execute();
  }
}
