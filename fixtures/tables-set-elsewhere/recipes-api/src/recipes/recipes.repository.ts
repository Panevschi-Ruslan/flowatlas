import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../db/base.repository.js';
import { RECIPES } from './recipe.names.js';

export interface Recipe { _id: string; title: string; popular: boolean }

/** The table set with a constant, on a `readonly` field: `recipes`, static. */
@Injectable()
export class RecipesRepository extends BaseRepository<Recipe> {
  protected readonly collectionName = RECIPES;

  // A finder of the class's own: `recipes`, read.
  findPopular(): Promise<Recipe[]> {
    return this.mongo.database().collection<Recipe>(this.collectionName).find({ popular: true }).toArray();
  }
}
