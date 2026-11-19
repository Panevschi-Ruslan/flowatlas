import { Controller, Get } from '@nestjs/common';

@Controller('store-rest')
export class ShopController {
  @Get('products')
  products(): string[] {
    return [];
  }

  @Get('orders')
  orders(): string[] {
    return [];
  }
}
