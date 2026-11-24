import { Body, Controller, Get, Param, Post } from '@nestjs/common';

/** What the shop's page shows of a store. */
export interface StoreCard {
  id: string;
  name: string;
  address: string;
}

/** What the back office creates a store with: every field required. */
export interface CreateStoreBody {
  name: string;
  address: string;
  phone: string;
  email: string;
  city: string;
  postcode: string;
  openingHours: string;
  priceTier: number;
}

/** A tree of categories as the menu is written: a name, or a list of trees. */
export type CategoryTree = string | CategoryTree[];

@Controller()
export class StoresController {
  @Get('stores/:id')
  async store(@Param('id') id: string): Promise<StoreCard> {
    return { id, name: 'Corner store', address: '1 High Street' };
  }

  @Post('stores')
  async create(@Body() body: CreateStoreBody): Promise<StoreCard> {
    return { id: 'new', name: body.name, address: body.address };
  }

  @Get('categories/tree')
  async categories(): Promise<CategoryTree> {
    return ['drinks', ['tea', 'coffee']];
  }
}
