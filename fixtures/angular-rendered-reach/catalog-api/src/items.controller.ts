import { Controller, Get, Param } from '@nestjs/common';
import { ItemsService } from './items.service';

/** The route every client of the front end requests. */
@Controller('items')
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get(':id')
  findOne(@Param('id') id: string): Promise<{ id: string; title: string }> {
    return this.items.findOne(id);
  }
}
