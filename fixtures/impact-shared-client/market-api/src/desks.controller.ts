import { Controller, Get, Param, Post } from '@nestjs/common';
import { DesksService } from './desks.service';

/** One route per method of the desks service. */
@Controller('api/staff/desks')
export class DesksController {
  constructor(private readonly desks: DesksService) {}

  @Get()
  list(): string[] {
    return this.desks.list();
  }

  @Post(':deskId/ack-call')
  ackCall(@Param('deskId') deskId: string): void {
    this.desks.ackCall(deskId);
  }

  @Post(':deskId/call')
  call(@Param('deskId') deskId: string): Promise<void> {
    return this.desks.call('main', deskId);
  }

  @Post(':deskId/close')
  close(@Param('deskId') deskId: string): void {
    this.desks.close(deskId);
  }
}
