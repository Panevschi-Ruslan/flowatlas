import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';

@Controller()
export class EventsController {
  @EventPattern('order.created')
  handleOrderCreated(@Payload() data: { orderId: string }): void {
    void data.orderId;
  }

  @MessagePattern({ cmd: 'sum' })
  sum(@Payload() numbers: number[]): number {
    return numbers.reduce((total, value) => total + value, 0);
  }
}
