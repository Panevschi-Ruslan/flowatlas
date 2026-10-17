import { Controller, Get } from '@nestjs/common';

import { CatalogueItem } from './catalogue-item.entity';
import { CatalogueService } from './catalogue.service';

/**
 * A `GET` under a catalogue-sounding path, with no guard and nothing in the
 * body: it stays `route-unguarded`. Public is never read off a verb, a path or
 * a name; only a marker, a decorator or the configuration says it.
 */
@Controller('catalogue')
export class CatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}

  @Get('items')
  items(): Promise<CatalogueItem[]> {
    return this.catalogue.all();
  }

  /** @flowatlas-public */
  @Get('new-arrivals')
  newArrivals(): Promise<CatalogueItem[]> {
    return this.catalogue.all();
  }
}
