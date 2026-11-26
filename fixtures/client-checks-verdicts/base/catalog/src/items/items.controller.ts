import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import type { ItemRow, ItemsQuery, ItemView, SearchHeaders, SearchQuery } from './item.types';
import { ItemsService } from './items.service';

@Controller('items')
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Post()
  async create(@Body() body: { name: string }): Promise<ItemView> {
    return this.items.create(body.name);
  }

  @Get('search')
  search(@Query() query: SearchQuery, @Headers() headers: SearchHeaders): ItemRow[] {
    return [{ id: headers['x-tenant'] ?? 'item-1', name: query.q ?? 'kettle' }];
  }

  @Get(':id')
  find(@Param('id') id: string): ItemView {
    return { id, name: 'kettle', status: 'live' };
  }

  @Get()
  list(@Query() query: ItemsQuery): ItemRow[] {
    return [{ id: query.page ?? 'item-1', name: 'kettle' }];
  }
}
