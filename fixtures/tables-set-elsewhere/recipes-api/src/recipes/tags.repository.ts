import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../db/base.repository.js';

export interface Tag { _id: string; label: string }

/**
 * The table set with a literal on a field that is not `readonly`: `tags`, and
 * heuristic, because another assignment could change it.
 */
@Injectable()
export class TagsRepository extends BaseRepository<Tag> {
  protected collectionName = 'tags';
}
