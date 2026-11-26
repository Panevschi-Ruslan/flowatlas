import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { TenantBus } from '../bus/tenant-bus.service';
import { formatCall, formatStepReady } from './format';
import { PushSender } from './push-sender.service';
import { RoomDirectory } from './room-directory.service';

/**
 * Sends a push for the types it keeps. `onEvent` parses the frame, returns
 * unless the type is one of `RELEVANT`, and hands the message to `dispatch`,
 * which holds it in a local made by a cast and switches on its type. The
 * call for staff reads `roomId` behind a presence check and returns early
 * without it: the publisher sends `roomNumber`, so the push never goes out.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private static readonly RELEVANT: ReadonlySet<string> = new Set(['CALL_STAFF', 'STEP_READY']);

  constructor(
    private readonly bus: TenantBus,
    private readonly sender: PushSender,
    private readonly rooms: RoomDirectory,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe('tenant:*:events', (raw: string) => this.onEvent(raw));
  }

  private onEvent(raw: string): void {
    const evt = JSON.parse(raw) as { type: string; scopeId: string };
    if (!PushService.RELEVANT.has(evt.type)) return;
    void this.dispatch(evt.scopeId, evt).catch(() => undefined);
  }

  private async dispatch(scopeId: string, raw: unknown): Promise<void> {
    const evt = raw as { type: string; roomId?: string; ts?: string; orderId?: string; step?: string };
    const assigned = await this.resolveAssigned(scopeId, evt);
    let formatted: string | null = null;
    switch (evt.type) {
      case 'CALL_STAFF': {
        if (!evt.roomId) return;
        const room = await this.rooms.findRoom(evt.roomId);
        if (!room) return;
        formatted = formatCall({ scopeId, roomId: evt.roomId, roomNumber: String(room.number), calledAt: evt.ts ?? new Date().toISOString() });
        break;
      }
      case 'STEP_READY': {
        formatted = formatStepReady({ orderId: evt.orderId, step: evt.step, assigned });
        break;
      }
    }
    if (formatted) await this.sender.send(scopeId, formatted);
  }

  private async resolveAssigned(scopeId: string, evt: { orderId?: string }): Promise<string[]> {
    return evt.orderId === undefined ? [] : [scopeId];
  }
}
