import { Injectable } from '@nestjs/common';

import { BusService } from '../bus/bus.service';

/**
 * Helpers that take the type of a message first and work the channel out
 * inside: the walk from the hub out to the channels it is handed must read the
 * channel here, and never take the type - nor an object - handed in for one.
 */
@Injectable()
export class CardEventsService {
  constructor(private readonly bus: BusService) {}

  async publishCardEvent(type: string, boardId: string, extra: Record<string, unknown>): Promise<void> {
    await this.bus.publish(`board:${boardId}:events`, { type, ...extra });
  }

  async relayImported(event: { source: string; type: 'CARD_IMPORTED' }, boardId: string): Promise<void> {
    await this.bus.publish(`board:${boardId}:events`, event);
  }

  async pin(boardId: string, cardId: string): Promise<void> {
    await this.publishCardEvent('CARD_PINNED', boardId, { cardId });
  }

  async importCard(boardId: string): Promise<void> {
    await this.relayImported({ source: 'import', type: 'CARD_IMPORTED' }, boardId);
  }
}
