import { Injectable } from '@nestjs/common';
import { InjectRepository, Repository } from 'typeorm';

import { Product } from './product.entity';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
  ) {}

  all(): Promise<Product[]> {
    return this.products.find();
  }

  featured(): Promise<Product[]> {
    return this.products.find({ where: { featured: true } });
  }

  count(): Promise<number> {
    return this.products.count();
  }
}
