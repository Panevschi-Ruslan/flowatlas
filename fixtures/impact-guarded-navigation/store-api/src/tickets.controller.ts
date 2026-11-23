import { Controller, Param, Post } from '@nestjs/common';
import { TicketsService } from './tickets.service';

@Controller('api/tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Post(':ticketId/ack')
  ack(@Param('ticketId') ticketId: string): void {
    this.tickets.acknowledge(ticketId);
  }
}
