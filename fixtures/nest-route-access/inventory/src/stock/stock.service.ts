import { Injectable } from '@nestjs/common';
import { InjectRepository, Repository } from 'typeorm';

import { StockItem } from './stock-item.entity';

@Injectable()
export class StockService {
  constructor(
    @InjectRepository(StockItem)
    private readonly items: Repository<StockItem>,
  ) {}

  all(): Promise<StockItem[]> {
    return this.items.find();
  }

  save(item: StockItem): Promise<StockItem> {
    return this.items.save(item);
  }
}
