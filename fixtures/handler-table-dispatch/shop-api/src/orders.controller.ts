import { Body, Controller, Get, Patch } from '@nestjs/common';
import { OrdersService } from './orders.service';

@Controller('api/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('active')
  active(): Promise<Array<{ id: string; summary: string }>> {
    return this.orders.listActive();
  }

  @Patch('status')
  setStatus(@Body() body: { orderId: string; status: string }): Promise<void> {
    return this.orders.setStatus(body.orderId, body.status);
  }
}
