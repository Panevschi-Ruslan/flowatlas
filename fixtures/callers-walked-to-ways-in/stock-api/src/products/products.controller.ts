import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ProductsService } from './products.service';

/**
 * Five routes: the catalog screen lists and creates, the product screen reads
 * and updates, and nothing requests the delete. The create's body is written
 * inline, a type of many fields.
 */
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(): string[] {
    return this.products.list();
  }

  @Get(':sku')
  one(@Param('sku') sku: string): string {
    return this.products.one(sku);
  }

  @Post()
  create(
    @Body()
    body: {
      sku: string;
      name: string;
      description?: string;
      image?: string;
      price: number;
      currency?: string;
      weight?: number;
      width?: number;
      height?: number;
      depth?: number;
      color?: string;
      brand?: string;
      category?: string;
      tags?: string[];
      barcode?: string;
      supplier?: string;
      origin?: string;
      taxClass?: string;
      visible?: boolean;
      featured?: boolean;
      minOrder?: number;
      maxOrder?: number;
    },
  ): string {
    return this.products.create(body.sku, body.name);
  }

  @Put(':sku')
  update(@Param('sku') sku: string, @Body() body: { name: string }): string {
    return this.products.rename(sku, body.name);
  }

  @Delete(':sku')
  remove(@Param('sku') sku: string): void {
    this.products.remove(sku);
  }
}
