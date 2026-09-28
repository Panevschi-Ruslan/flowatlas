import type { Collection, Document } from 'mongodb';
import { MongoConnection } from './connection.js';

/**
 * The repository base the configuration names with `tableProperty`: each class
 * extending it sets `collectionName`, and that is the table of every call made
 * through it.
 */
export abstract class BaseRepository<T extends Document> {
  protected abstract readonly collectionName: string;

  constructor(protected readonly mongo: MongoConnection) {}

  protected coll(): Collection<T> {
    return this.mongo.collection<T>(this.collectionName);
  }

  findById(id: string): Promise<T | null> {
    return this.coll().findOne({ _id: id } as Partial<T>);
  }

  findAll(): Promise<T[]> {
    return this.coll().find({}).toArray();
  }
}
