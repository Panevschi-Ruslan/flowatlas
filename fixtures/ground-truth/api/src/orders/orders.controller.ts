import { Body, Controller, Get, Param, Patch } from '@nestjs/common';

import { OrdersService } from './orders.service';

/**
 * Two names for one controller, and a verb nothing else in the fixtures uses.
 *
 * `@Controller(['orders', 'o'])` is two prefixes, so every method below opens
 * two ways in and a client may ask for either. `@Patch` is the third verb: the
 * other fixtures only ever write a GET or a POST, so a table that maps a verb
 * to the wrong one has nothing here to contradict it.
 */
@Controller(['orders', 'o'])
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get(':id')
  findOne(@Param('id') id: string): { id: string } {
    return this.orders.findOne(id);
  }

  @Patch(':id')
  rename(@Param('id') id: string, @Body() body: { name: string }): { id: string; name: string } {
    return this.orders.rename(id, body.name);
  }
}
