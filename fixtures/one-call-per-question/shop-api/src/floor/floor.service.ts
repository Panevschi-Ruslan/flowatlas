import { Injectable } from '@nestjs/common';
import { EventBus } from '../bus/event-bus';

@Injectable()
export class FloorService {
  constructor(private readonly bus: EventBus) {}

  /** The same type of message as a desk's call for help, on the floor's own channel. */
  async callStaff(table: number, note: string): Promise<void> {
    await this.bus.publish('floor_events', { type: 'HELP_REQUESTED', table, note });
  }
}
