import { Injectable } from '@nestjs/common';

import { RoomBoard } from './room-board.service';

/** Fans every message out, and lets the room board look at each. */
@Injectable()
export class FeedGateway {
  private readonly sent: unknown[] = [];

  constructor(private readonly board: RoomBoard) {}

  push(message: unknown): void {
    this.fanOut(message);
  }

  fanOut(message: unknown): void {
    this.sent.push(message);
    this.board.apply(message as { type: string; roomId: string });
  }
}
