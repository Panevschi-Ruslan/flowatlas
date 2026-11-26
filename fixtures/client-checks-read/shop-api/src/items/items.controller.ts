import { Controller, Get, Param } from '@nestjs/common';

/** One item as the API answers it: no `promo`, no `badge`, no `legacyCode`. */
export interface ItemView {
  id: string;
  name: string;
  price: number;
  status: 'draft' | 'live' | 'sold';
}

/** How often an item was looked at: no `shares`. */
export interface ItemStats {
  views: number;
  saves: number;
}

@Controller('items')
export class ItemsController {
  @Get(':id')
  one(@Param('id') id: string): ItemView {
    return { id, name: '', price: 0, status: 'draft' };
  }

  @Get(':id/stats')
  stats(@Param('id') id: string): ItemStats {
    return { views: id.length, saves: 0 };
  }
}
