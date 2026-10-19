import type { Document } from 'mongodb';
import { BaseRepository } from './base.repository.js';

/** A second level of base: its classes still set the field the first one reads. */
export abstract class TimestampedRepository<T extends Document> extends BaseRepository<T> {
  findLatest(): Promise<T[]> {
    return this.mongo.database().collection<T>(this.collectionName).find({}).toArray();
  }
}
