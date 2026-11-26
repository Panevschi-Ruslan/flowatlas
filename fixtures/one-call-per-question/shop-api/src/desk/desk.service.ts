import { Injectable } from '@nestjs/common';
import { EventBus } from '../bus/event-bus';

@Injectable()
export class DeskService {
  constructor(private readonly bus: EventBus) {}

  /** Sends the desk's number as `deskNumber`; the bot's handler expects `deskId`. */
  async requestHelp(deskNumber: number, note: string): Promise<void> {
    await this.bus.publish('desk_events', { type: 'HELP_REQUESTED', deskNumber, note });
  }
}
