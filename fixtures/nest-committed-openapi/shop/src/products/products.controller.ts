import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import type { CreateProductDto, ProductDto, ReviewDto } from './dto';

/**
 * The routes `openapi.yaml` beside this repository describes by hand. It
 * still lists `DELETE /products/{id}`, which this controller no longer has,
 * and says nothing of `GET /products/:id/reviews`, which it gained.
 */
@Controller('products')
export class ProductsController {
  @Get()
  list(@Query('page') page?: number): Promise<ProductDto[]> {
    return Promise.resolve([]);
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<ProductDto> {
    return Promise.resolve({ id, name: '', price: 0 });
  }

  @Post()
  create(@Body() body: CreateProductDto): Promise<ProductDto> {
    return Promise.resolve({ id: '1', ...body });
  }

  @Get(':id/reviews')
  reviews(@Param('id') id: string): Promise<ReviewDto[]> {
    return Promise.resolve([]);
  }
}
