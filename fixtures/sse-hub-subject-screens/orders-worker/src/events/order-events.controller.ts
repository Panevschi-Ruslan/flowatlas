import { Body, Controller, Post } from '@nestjs/common';
import { Consumes } from '@flowatlas/markers';

interface OrderEvent {
  type: string;
  orderId?: string;
}

/**
 * What the boards' bus posts to the worker: every message of a board's orders
 * channel, dispatched by its type.
 */
@Controller('events')
export class OrderEventsController {
  @Post('orders')
  @Consumes('board:*:orders')
  receive(@Body() event: OrderEvent): string {
    switch (event.type) {
      case 'SCHEDULED_ALERT':
        return this.handleScheduledAlert(event);
      case 'ORDER_PLACED':
        return this.recordPlaced(event);
      default:
        return 'ignored';
    }
  }

  handleScheduledAlert(event: OrderEvent): string {
    return `alert ${event.orderId ?? ''}`;
  }

  recordPlaced(event: OrderEvent): string {
    return `placed ${event.orderId ?? ''}`;
  }
}
