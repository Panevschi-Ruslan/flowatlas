import { Body, Controller, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ClientGuard } from '../auth/client.guard';
import { OrdersService } from './orders.service';

interface CancelOrderBody {
  userRef?: string;
}

interface ReadyBody {
  label: string;
  printer?: string;
}

@Controller('api/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** The body is declared and never read here: the guard in front of the route reads it. */
  @Patch(':id/cancel')
  @UseGuards(ClientGuard)
  async cancel(@Param('id') id: string, @Body() _body: CancelOrderBody): Promise<void> {
    await this.orders.cancel(id, 'cancelled by the client');
  }

  @Post(':id/ready')
  async ready(@Param('id') id: string, @Body() body: ReadyBody): Promise<void> {
    await this.orders.markReady(id, body.label);
  }
}
