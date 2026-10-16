import { Controller, Get, Param, Post } from '@nestjs/common';

import { ShopClient } from './clients/shop.client';

/** The ways in that make every request below, so each one sits on a flow. */
@Controller('checkout')
export class CheckoutController {
  constructor(private readonly shop: ShopClient) {}

  @Get(':id')
  async summary(@Param('id') id: string): Promise<unknown> {
    const order = await this.shop.order(id);
    const history = await this.shop.history(id);
    const rates = await this.shop.rates();
    const stock = await this.shop.stock();
    const products = await this.shop.products();
    return { order, history, rates, stock, products };
  }

  @Post(':id')
  async pay(@Param('id') id: string): Promise<unknown> {
    await this.shop.pay(id);
    return this.shop.refund(id);
  }
}
