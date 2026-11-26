import { Controller, Get, Param } from '@nestjs/common';

/** The prefix is computed, so none of these routes is read: the decoy. */
const prefixOf = (name: string): string => `${name}`;

@Controller(prefixOf('items'))
export class ItemsController {
  @Get(':id')
  findOne(@Param('id') id: string): string {
    return id;
  }
}
