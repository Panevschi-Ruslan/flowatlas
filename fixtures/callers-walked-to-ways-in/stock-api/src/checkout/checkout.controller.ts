import { Body, Controller, Delete, Param, Post } from '@nestjs/common';
import { CheckoutService } from './checkout.service';

@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post()
  place(@Body() body: { sku: string; qty: number }): boolean {
    return this.checkout.place(body.sku, body.qty);
  }

  @Delete(':sku')
  cancel(@Param('sku') sku: string, @Body() body: { qty: number }): number {
    return this.checkout.cancel(sku, body.qty);
  }
}
