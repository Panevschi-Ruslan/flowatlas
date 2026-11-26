import { Controller, Get, Query } from '@nestjs/common';
import { ItemsService } from './items.service';

@Controller('api/shops')
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get('items')
  list(@Query('shopId') shopId: string): string[] {
    return this.items.listByShop(shopId);
  }
}
