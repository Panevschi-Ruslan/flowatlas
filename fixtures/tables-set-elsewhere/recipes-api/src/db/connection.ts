import { Injectable } from '@nestjs/common';
import { MongoClient, type Db } from 'mongodb';

/** The project's own wrapper over the client, as a repository base expects. */
@Injectable()
export class MongoConnection {
  private readonly client = new MongoClient();

  database(): Db {
    return this.client.db('recipes');
  }
}
