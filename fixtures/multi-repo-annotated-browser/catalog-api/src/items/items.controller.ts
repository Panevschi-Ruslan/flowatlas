import { Body, Controller, Get, Post } from '@nestjs/common';

export interface Item {
  id: string;
  title: string;
}

/** The bookshop's catalogue. Both routes are reached only through an annotation that names this service. */
@Controller('items')
export class ItemsController {
  @Get()
  list(): Item[] {
    return [];
  }

  @Post()
  create(@Body() body: { title: string }): Item {
    return { id: '1', title: body.title };
  }
}
