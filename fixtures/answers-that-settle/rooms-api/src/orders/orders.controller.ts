import { Controller, Param, Post } from '@nestjs/common';

import { OrdersService } from './orders.service';

@Controller('api/venues/:venueId/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post(':orderId/ready/:roomId')
  ready(@Param('venueId') venueId: string, @Param('orderId') orderId: string, @Param('roomId') roomId: string): void {
    this.orders.markReady(venueId, orderId, roomId);
  }

  @Post(':orderId/paid')
  paid(@Param('venueId') venueId: string, @Param('orderId') orderId: string): void {
    this.orders.markPaid(venueId, orderId);
  }

  @Post('tables/:roomId/free')
  free(@Param('venueId') venueId: string, @Param('roomId') roomId: string): void {
    this.orders.freeTable(venueId, roomId);
  }
}
