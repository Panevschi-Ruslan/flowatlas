import { Body, Controller, Param, Post } from '@nestjs/common';
import { TicketsService } from './tickets.service';

@Controller('desks/:deskId/tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Post(':ticketId/assign')
  assign(@Param('deskId') deskId: string, @Param('ticketId') ticketId: string, @Body() body: { agentId: string }): Promise<void> {
    return this.tickets.assign(deskId, ticketId, body.agentId);
  }

  @Post(':ticketId/close')
  close(@Param('deskId') deskId: string, @Param('ticketId') ticketId: string): Promise<void> {
    return this.tickets.close(deskId, ticketId);
  }
}
