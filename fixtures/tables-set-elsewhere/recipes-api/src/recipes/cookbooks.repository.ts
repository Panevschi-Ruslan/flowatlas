import { Injectable } from '@nestjs/common';
import { TimestampedRepository } from '../db/timestamped.repository.js';

export interface Cookbook { _id: string; title: string }

/** Two bases down, the table set with a literal: `cookbooks`. */
@Injectable()
export class CookbooksRepository extends TimestampedRepository<Cookbook> {
  protected readonly collectionName = 'cookbooks';
}
