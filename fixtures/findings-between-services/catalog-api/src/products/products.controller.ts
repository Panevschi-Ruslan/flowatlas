import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { StaffGuard } from '../auth/staff.guard';
import { ProductsService } from './products.service';

interface CreateProductBody {
  name?: string;
  priceCents?: number;
}

/**
 * Four routes. Three have `StaffGuard` in front of them; `remove` was left
 * without one and deletes a row: the route unguarded while its siblings are
 * guarded. `publish` is the route the storefront's `release` call was meant
 * for.
 */
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get(':id')
  @UseGuards(StaffGuard)
  findOne(@Param('id') id: string): Promise<unknown> {
    return this.products.findOne(id);
  }

  /** Reads `body.name`; the storefront sends `productName`. */
  @Post()
  @UseGuards(StaffGuard)
  create(@Body() body: CreateProductBody): Promise<unknown> {
    return this.products.create(body.name, body.priceCents);
  }

  @Post(':id/publish')
  @UseGuards(StaffGuard)
  publish(@Param('id') id: string): Promise<void> {
    return this.products.publish(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<void> {
    return this.products.remove(id);
  }
}
