import type { Document } from 'mongodb';
import { MongoConnection } from './connection.js';

/**
 * A base the configuration names as a bare string: its classes state their
 * table too, but nothing has said where, so a call through it is a query with no
 * table and a row naming the key that would read it.
 */
export abstract class LegacyRepository<T extends Document> {
  protected abstract readonly source: string;

  constructor(protected readonly mongo: MongoConnection) {}

  list(): Promise<T[]> {
    return this.mongo.collection<T>(this.source).find({}).toArray();
  }
}
