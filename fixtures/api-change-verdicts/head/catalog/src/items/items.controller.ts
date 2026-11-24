import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { ArchivedItemView, CreateItemBody, ItemRow, ItemView } from './item.types';
import { ItemsService } from './items.service';

@Controller('items')
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Post()
  async create(@Body() body: CreateItemBody): Promise<ItemView> {
    return this.items.create(body);
  }

  @Get(':id')
  find(@Param('id') id: string): ItemView {
    return { id, name: 'kettle' };
  }

  @Get(':id/archive')
  archived(@Param('id') id: string): ArchivedItemView {
    return { id, archivedAt: '2026-01-01' };
  }

  @Get()
  list(): ItemRow[] {
    return [{ id: 'item-1', name: 'kettle' }];
  }
}
