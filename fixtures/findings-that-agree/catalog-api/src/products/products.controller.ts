import { ClassSerializerInterceptor, Controller, Get, Param, UseInterceptors } from '@nestjs/common';
import { ProductCard } from './product-card';

@Controller('products')
@UseInterceptors(ClassSerializerInterceptor)
export class ProductsController {
  @Get(':id')
  product(@Param('id') id: string): ProductCard {
    const card = new ProductCard();
    card.id = id;
    card.name = 'Green tea';
    card.price = 4;
    card.costPrice = 1;
    return card;
  }
}
