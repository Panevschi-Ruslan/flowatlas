import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CatalogClient } from './catalog.client';

interface NewItem {
  name: string;
  price: number;
}

@Controller('shop')
export class ShopController {
  constructor(private readonly catalog: CatalogClient) {}

  @Post('items')
  async add(@Body() body: NewItem): Promise<void> {
    await this.catalog.createItem(body.name, body.price);
  }

  @Post('drafts')
  async draft(@Body('title') title: string): Promise<void> {
    await this.catalog.saveDraft(title);
  }

  @Delete('items/:id')
  async drop(@Param('id') id: string): Promise<void> {
    await this.catalog.removeItem(id);
  }

  @Get('items/:id')
  async show(@Param('id') id: string): Promise<string> {
    const item = await this.catalog.getItem(id);
    return `${item.name}: ${item.price}`;
  }
}
