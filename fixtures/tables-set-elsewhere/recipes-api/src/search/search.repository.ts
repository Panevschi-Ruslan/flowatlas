import { Injectable } from '@nestjs/common';
import { MongoConnection } from '../db/connection.js';

/**
 * A repository of the project's own with no base: named like data, and read
 * where its query is written.
 */
@Injectable()
export class SearchRepository {
  constructor(private readonly mongo: MongoConnection) {}

  lookup(term: string): Promise<unknown> {
    return this.mongo.database().collection('search_index').findOne({ term });
  }
}
