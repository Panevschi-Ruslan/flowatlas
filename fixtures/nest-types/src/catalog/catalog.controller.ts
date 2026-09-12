import { Controller, Get, Query } from '@nestjs/common';

import { Category } from '../types/category';
import { A } from '../types/cycle';
import { L0 } from '../types/deep';
import { Kind, Status } from '../types/order';
import { Shape2 } from '../types/shapes';
import { CatalogService } from './catalog.service';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories')
  categories(): Category[] {
    return this.catalog.categories();
  }

  @Get('cycle')
  cycle(): A {
    return this.catalog.cycle();
  }

  @Get('shapes')
  shapes(): Shape2 {
    return this.catalog.shapes({ id: 'x', count: 1, tags: [] });
  }

  @Get('deep')
  deep(): L0 {
    return this.catalog.deep();
  }

  /** `meta.query: { kind: type:nest-types#Kind }` (inline, single named query param). */
  @Get('status')
  classify(@Query('kind') kind: Kind): Status {
    return this.catalog.classify(kind);
  }
}
