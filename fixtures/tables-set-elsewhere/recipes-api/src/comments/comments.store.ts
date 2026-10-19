import { Injectable } from '@nestjs/common';
import type { Collection } from 'mongodb';
import { MongoConnection } from '../db/connection.js';
import { COMMENTS } from './comment.names.js';

export interface Comment { _id: string; recipeId: string; body: string }

/** A store that hands its collection out of a private helper and a getter. */
@Injectable()
export class CommentsStore {
  constructor(private readonly mongo: MongoConnection) {}

  private coll(): Collection<Comment> {
    return this.mongo.database().collection<Comment>(COMMENTS);
  }

  get collection(): Collection<Comment> {
    return this.mongo.database().collection<Comment>(COMMENTS);
  }

  // Through the helper: `comments`, write.
  add(comment: Comment): Promise<unknown> {
    return this.coll().insertOne(comment);
  }

  // Through the getter: `comments`, read.
  forRecipe(recipeId: string): Promise<Comment[]> {
    return this.collection.find({ recipeId }).toArray();
  }

  // A helper whose table is its caller's argument: a gap.
  private named(name: string): Collection<Comment> {
    return this.mongo.database().collection<Comment>(name);
  }

  flag(comment: Comment): Promise<unknown> {
    return this.named('comment_flags').insertOne(comment);
  }
}
