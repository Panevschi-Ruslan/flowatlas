import { Controller, Param, Post } from '@nestjs/common';

@Controller('sync')
export class SyncController {
  @Post(':id')
  async sync(@Param('id') id: string): Promise<unknown> {
    const item = await fetch(`${process.env.CATALOG_URL}/items/${id}`);
    const rates = await fetch(`${process.env.RATES_URL}/rates`);
    return { item, rates };
  }
}
