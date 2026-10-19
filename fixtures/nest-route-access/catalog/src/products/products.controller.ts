import { Controller, Get, Param, Post } from '@nestjs/common';

import { OpenRoute } from '../auth/open-route.decorator';
import { Public } from '../auth/public.decorator';
import { Strict } from '../auth/strict.decorator';
import { Product } from './product.entity';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /** Behind the application-wide `JwtAuthGuard`: no row. */
  @Get()
  all(): Promise<Product[]> {
    return this.products.all();
  }

  /** `@Public()`, which `JwtAuthGuard` reads: open on purpose, no row. */
  @Get('featured')
  @Public()
  featured(): Promise<Product[]> {
    return this.products.featured();
  }

  /** `@OpenRoute()` wraps `@Public()` in `applyDecorators`: open on purpose, no row. */
  @Get(':id/related')
  @OpenRoute()
  related(@Param('id') _id: string): Promise<Product[]> {
    return this.products.featured();
  }

  /** `@Strict()` is read by the guard too, and switches nothing off: still guarded, no row. */
  @Post('import')
  @Strict()
  import(): Promise<Product[]> {
    return this.products.all();
  }
}
