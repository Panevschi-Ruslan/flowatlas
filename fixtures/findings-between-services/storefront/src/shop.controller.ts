import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CatalogClient } from './catalog.client';
import { LegacyClient } from './legacy.client';

/** What the shop's pages ask the storefront's server for. */
@Controller('shop')
export class ShopController {
  constructor(
    private readonly catalog: CatalogClient,
    private readonly legacy: LegacyClient,
  ) {}

  @Get('products/:id')
  product(@Param('id') id: string): Promise<unknown> {
    return this.catalog.product(id);
  }

  @Post('products/:id/release')
  release(@Param('id') id: string): Promise<void> {
    return this.catalog.release(id);
  }

  @Post('products')
  create(@Body() body: { name: string; priceCents: number }): Promise<unknown> {
    return this.catalog.create(body.name, body.priceCents);
  }

  @Get('stock/:sku')
  stock(@Param('sku') sku: string): Promise<number> {
    return this.catalog.stock(sku);
  }

  @Get('products/:id/reviews')
  reviews(@Param('id') id: string): Promise<unknown> {
    return this.catalog.reviews(`/products/${id}/reviews`);
  }

  @Get('items/:id')
  item(@Param('id') id: string): Promise<unknown> {
    return this.legacy.item(id);
  }
}
