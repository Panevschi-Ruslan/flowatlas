import { Controller, Get, Param } from '@nestjs/common';

/** Served at `/v1/orders` wherever the deployment leaves the mount empty. */
@Controller('orders')
export class OrdersController {
  @Get()
  list(): string[] {
    return [];
  }

  @Get(':id')
  one(@Param('id') id: string): string {
    return id;
  }
}
