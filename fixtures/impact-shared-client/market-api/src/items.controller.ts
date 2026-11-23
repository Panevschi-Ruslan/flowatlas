import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ItemsService } from './items.service';

/** `GET /api/items` is the one route serving `ItemsService.listByShop`. */
@Controller('api/items')
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  list(@Query('shopId') shopId: string): string[] {
    return this.items.listByShop(shopId);
  }

  @Post()
  create(@Body() body: { shopId: string; name: string }): Promise<void> {
    return this.items.create(body.shopId, body.name);
  }
}
