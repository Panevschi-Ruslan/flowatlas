import { Injectable } from '@nestjs/common';

/** Three calls past the relay, compares the type by name: the graph reads no choice here. */
@Injectable()
export class RoomBoard {
  private readonly free = new Set<string>();

  apply(evt: { type: string; roomId: string }): void {
    if (evt.type === 'TABLE_FREED') this.free.add(evt.roomId);
  }
}
