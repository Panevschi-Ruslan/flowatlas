import { Injectable } from '@nestjs/common';
import { InjectRepository, Repository } from 'typeorm';

import { CatalogueItem } from './catalogue-item.entity';

@Injectable()
export class CatalogueService {
  constructor(
    @InjectRepository(CatalogueItem)
    private readonly items: Repository<CatalogueItem>,
  ) {}

  all(): Promise<CatalogueItem[]> {
    return this.items.find();
  }
}
