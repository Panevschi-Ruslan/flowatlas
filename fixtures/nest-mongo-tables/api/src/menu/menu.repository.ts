import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../db/base.repository.js';

export interface MenuItem { _id: string; name: string; category: string }

/** The table stated with a literal. */
@Injectable()
export class MenuRepository extends BaseRepository<MenuItem> {
  protected readonly collectionName = 'menuItems';

  // A finder of the class's own, through the base's accessor: `menuItems`, read.
  findByCategory(category: string): Promise<MenuItem[]> {
    return this.coll().find({ category }).toArray();
  }
}
