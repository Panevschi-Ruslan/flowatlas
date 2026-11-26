import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import { RoomsService } from './rooms.service';

@Controller('api/admin/:venueId/rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Get('free-times')
  freeTimes(@Param('venueId') venueId: string): string[] {
    return this.rooms.freeTimes(venueId);
  }

  @Post(':roomId/claim')
  claim(@Param('venueId') venueId: string, @Param('roomId') roomId: string): void {
    this.rooms.claimRow(venueId, roomId);
  }

  @Post(':roomId/call')
  call(@Param('venueId') venueId: string, @Param('roomId') roomId: string, @Body() body: { note: string }): void {
    this.rooms.callStaff(venueId, roomId, body.note);
  }

  @Post(':roomId/ready')
  ready(@Param('venueId') venueId: string, @Param('roomId') roomId: string, @Body() body: { roomName: string }): void {
    this.rooms.roomReady(venueId, roomId, body.roomName);
  }
}
