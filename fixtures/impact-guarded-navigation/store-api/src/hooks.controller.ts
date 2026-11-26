import { Body, Controller, Post } from '@nestjs/common';
import { TicketsService } from './tickets.service';

/** A chat platform's webhook: a button pressed in a chat acknowledges the ticket directly. */
@Controller('api/hooks')
export class HooksController {
  constructor(private readonly tickets: TicketsService) {}

  @Post('chat')
  chat(@Body() body: { ticketId: string }): void {
    this.tickets.acknowledge(body.ticketId);
  }
}
