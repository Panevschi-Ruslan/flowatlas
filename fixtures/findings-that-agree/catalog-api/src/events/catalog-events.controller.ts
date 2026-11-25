import { Controller, Param, Post } from '@nestjs/common';
import { CatalogService } from './catalog.service';

@Controller('catalog/:sku')
export class CatalogEventsController {
  constructor(private readonly catalog: CatalogService) {}

  @Post('price/:price')
  price(@Param('sku') sku: string, @Param('price') price: string): Promise<void> {
    return this.catalog.priceChanged(sku, Number(price));
  }

  @Post('stock/:left')
  stock(@Param('sku') sku: string, @Param('left') left: string): Promise<void> {
    return this.catalog.stockLow(sku, Number(left));
  }

  @Post('retire/:reason')
  retire(@Param('sku') sku: string, @Param('reason') reason: string): Promise<void> {
    return this.catalog.retired(sku, reason);
  }
}
