import { Injectable } from '@nestjs/common';
import { knex } from 'knex';

/** The table named once, to show that a constant is followed like a literal. */
const USERS = 'users';

@Injectable()
export class UsersService {
  private readonly db = knex();

  // A read whose table is a literal in the call the chain started from.
  findAll(): Promise<unknown[]> {
    return this.db('users').select('id', 'email');
  }

  // A read at the end of a longer chain. The operation is on `first`, three
  // calls away from the table, and both belong to one visit to the database.
  findOne(id: string): Promise<unknown> {
    return this.db('users').where({ id }).orderBy('email').first();
  }

  // A read whose table is a constant rather than a literal.
  count(): Promise<unknown> {
    return this.db(USERS).count('id');
  }

  // The other shape, and the one real repositories are full of: the query
  // starts from the columns and names the table in a `from` halfway along. The
  // call the chain started from holds a column here, so reading it as the table
  // would put `id` in the graph as a name — which is exactly what the first run
  // against directus did.
  byEmail(email: string): Promise<unknown> {
    return this.db.select('id').from('users').whereRaw('lower(email) = ?').first();
  }

  // A write.
  create(email: string): Promise<unknown[]> {
    return this.db('users').insert({ email }).returning('id');
  }

  // A write on a second table, so the fixture has more than one table node.
  audit(userId: string): Promise<unknown[]> {
    return this.db('user_events').insert({ userId, kind: 'created' }).returning('id');
  }

  rename(id: string, email: string): Promise<number> {
    return this.db('users').where({ id }).update({ email });
  }

  remove(id: string): Promise<number> {
    return this.db('users').where({ id }).del();
  }

  // A chain of one. The counted column is the only argument there is, and
  // reading it as a table would be a name that looks like an answer and is not.
  // Expected: no table, and a `dynamic-table-name` row.
  total(): Promise<unknown> {
    return this.db.count('*').first();
  }

  // The table is chosen by the caller, so nothing can be read from the source.
  // Expected: the query is still a node, with no table and a `dynamic-table-name`
  // row saying why.
  purge(table: string): Promise<number> {
    return this.db(table).del();
  }
}
