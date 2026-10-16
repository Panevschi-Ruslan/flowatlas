import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../db/base.repository.js';

export interface Product { _id: string; name: string; category: string }

/** The table stated with a literal. */
@Injectable()
export class ProductRepository extends BaseRepository<Product> {
  protected readonly collectionName = 'products';

  // A finder of the class's own, through the base's accessor: `products`, read.
  findByCategory(category: string): Promise<Product[]> {
    return this.coll().find({ category }).toArray();
  }
}
