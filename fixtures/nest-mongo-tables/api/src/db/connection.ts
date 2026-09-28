import { Injectable } from '@nestjs/common';
import { MongoClient, type Collection, type Document } from 'mongodb';

/** The project's own wrapper over the client, as a repository base expects. */
@Injectable()
export class MongoConnection {
  private readonly client = new MongoClient();

  collection<T extends Document>(name: string): Collection<T> {
    return this.client.db().collection<T>(name);
  }
}
