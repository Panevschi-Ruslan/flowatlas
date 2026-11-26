import { Injectable } from '@nestjs/common';

import { BoardEventBus } from '../bus/board-event-bus';

/**
 * One channel per board, many kinds of message on it, each published through
 * the project's bus; a crew channel the bus hands to the hub too, and an audit
 * channel it hands to the worker alone.
 */
@Injectable()
export class BoardsService {
  constructor(private readonly bus: BoardEventBus) {}

  async moveCard(boardId: string, cardId: string, column: string): Promise<void> {
    await this.bus.publish(`board:${boardId}:events`, { type: 'CARD_MOVED', cardId, column });
  }

  async addCard(boardId: string, cardId: string): Promise<void> {
    await this.bus.publish(`board:${boardId}:events`, { type: 'CARD_ADDED', cardId });
  }

  async archiveCard(boardId: string, cardId: string): Promise<void> {
    await this.bus.publish(`board:${boardId}:events`, { type: 'CARD_ARCHIVED', cardId });
  }

  /** Selected only by a watcher of a stream service nothing injects. */
  async renameBoard(boardId: string, title: string): Promise<void> {
    await this.bus.publish(`board:${boardId}:events`, { type: 'BOARD_RENAMED', title });
  }

  /** Selected by no screen at all. */
  async commentOnCard(boardId: string, cardId: string, text: string): Promise<void> {
    await this.bus.publish(`board:${boardId}:events`, { type: 'CARD_COMMENTED', cardId, text });
  }

  /** A crew's channel: routed to the hub and the worker both. */
  async assignCrew(crewId: string, boardId: string): Promise<void> {
    await this.bus.publish(`crew:${crewId}:shifts`, { type: 'CREW_ASSIGNED', boardId });
  }

  /** Routed to the worker alone: never relayed to a screen. */
  async auditBoard(boardId: string, actor: string): Promise<void> {
    await this.bus.publish(`board:${boardId}:audit`, { type: 'BOARD_AUDITED', actor });
  }
}
