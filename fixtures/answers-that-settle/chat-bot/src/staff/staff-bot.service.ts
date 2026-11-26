import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { VenueBus } from '../bus/venue-bus.service';

interface StaffMessage {
  type: string;
  roomId: string;
  roomName?: string;
}

/** Reads `roomName` of `ROOM_READY` on `staff_feed`, the second channel the type is told on. */
@Injectable()
export class StaffBot implements OnModuleInit {
  private readonly lines: string[] = [];

  constructor(private readonly bus: VenueBus) {}

  onModuleInit(): void {
    this.bus.subscribe('staff_feed', (evt: StaffMessage) => this.onEvent(evt));
  }

  onEvent(evt: StaffMessage): void {
    if (evt.type === 'ROOM_READY') this.handleRoomReady(evt);
  }

  handleRoomReady(evt: StaffMessage): void {
    this.lines.push(`${evt.roomName ?? evt.roomId} is ready`);
  }
}
