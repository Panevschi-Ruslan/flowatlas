import { Body, Controller, Get, Post } from '@nestjs/common';

/** One order line. Both services serve the same two routes, so the route alone names neither. */
export interface Item {
  id: string;
  name: string;
}

@Controller('items')
export class ItemsController {
  private readonly items: Item[] = [];

  @Get()
  list(): Item[] {
    return this.items;
  }

  @Post()
  create(@Body() body: { name: string }): Item {
    const item: Item = { id: String(this.items.length + 1), name: body.name };
    this.items.push(item);
    return item;
  }
}
