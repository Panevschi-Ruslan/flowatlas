import { Module } from '@nestjs/common';

import { VenueBus } from './bus/venue-bus.service';
import { RoomService } from './rooms/room.service';
import { SlotRenderer } from './rooms/slot-renderer.service';
import { StaffBot } from './staff/staff-bot.service';

@Module({
  providers: [VenueBus, RoomService, SlotRenderer, StaffBot],
})
export class AppModule {}
