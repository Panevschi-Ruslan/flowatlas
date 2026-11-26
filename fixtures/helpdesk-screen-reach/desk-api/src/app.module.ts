import { Module } from '@nestjs/common';
import { LiveController } from './live/live.controller';
import { TicketsController } from './tickets/tickets.controller';
import { TicketsService } from './tickets/tickets.service';

@Module({
  controllers: [TicketsController, LiveController],
  providers: [TicketsService],
})
export class AppModule {}
