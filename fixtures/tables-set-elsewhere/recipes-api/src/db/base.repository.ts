import type { Document } from 'mongodb';
import { MongoConnection } from './connection.js';

/**
 * A repository base nothing configures. Its queries hand `this.collectionName`
 * to the driver's own table argument, which says where every class extending it
 * names its table, so each call through one of them is read on that class's
 * table. The queries written here run for every such class and name none.
 */
export abstract class BaseRepository<T extends Document> {
  protected abstract readonly collectionName: string;

  constructor(protected readonly mongo: MongoConnection) {}

  findAll(): Promise<T[]> {
    return this.mongo.database().collection<T>(this.collectionName).find({}).toArray();
  }

  insert(doc: T): Promise<unknown> {
    return this.mongo.database().collection<T>(this.collectionName).insertOne(doc);
  }
}
