import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { VenueBus } from '../bus/venue-bus.service';
import { PushSender } from './push-sender.service';

interface Room {
  id: string;
  name: string;
}

/** A call for staff as a push line. */
export const formatCall = (input: { room: Room; note?: string }): string => `${input.room.name}: ${input.note ?? 'staff called'}`;

/**
 * Sends a push for the types it keeps: the subscriber returns unless the type
 * is one of `RELEVANT`, then hands the message to `dispatch`, whose switch
 * looks the room up first in each case. A case that is code of its own is
 * handled by `dispatch`, not by the lookup.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private static readonly RELEVANT: ReadonlySet<string> = new Set(['CALL_STAFF', 'ORDER_READY']);

  constructor(
    private readonly bus: VenueBus,
    private readonly sender: PushSender,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe('venue_events', (raw: string) => {
      const evt = JSON.parse(raw) as { type: string; venueId: string };
      if (!PushService.RELEVANT.has(evt.type)) return;
      void this.dispatch(evt.venueId, evt);
    });
  }

  async dispatch(venueId: string, raw: unknown): Promise<void> {
    const evt = raw as { type: string; roomId?: string; note?: string };
    await this.sender.warm(venueId);
    let formatted: string | undefined;
    switch (evt.type) {
      case 'CALL_STAFF': {
        if (!evt.roomId) return;
        const room = await this.findRoom(evt.roomId);
        if (!room) return;
        formatted = formatCall({ room, note: evt.note });
        break;
      }
      case 'ORDER_READY':
        await this.sendReady(evt);
        break;
    }
    if (formatted) await this.sender.send(venueId, formatted);
  }

  async findRoom(roomId: string): Promise<Room | undefined> {
    return { id: roomId, name: `Room ${roomId}` };
  }

  async sendReady(evt: { roomId?: string }): Promise<void> {
    await this.sender.send(evt.roomId ?? '', 'order ready');
  }
}
