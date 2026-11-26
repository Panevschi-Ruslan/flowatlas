import { Injectable } from '@nestjs/common';
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';

/** The publisher: one channel per board and per team, one for every alert, one for the digest. */
@Injectable()
export class BoardsService {
  private readonly bus: RedisClientType = createClient();

  async addCard(boardId: string, teamId: string, title: string): Promise<void> {
    await this.bus.publish(`board:${boardId}:activity`, JSON.stringify({ type: 'CARD_ADDED', title }));
    await this.bus.publish(`team:${teamId}:feed`, JSON.stringify({ type: 'CARD_ADDED', boardId, title }));
  }

  async raiseAlert(text: string): Promise<void> {
    await this.bus.publish('alerts:global', JSON.stringify({ type: 'ALERT', text }));
  }

  async sendDigest(summary: string): Promise<void> {
    await this.bus.publish('digest:daily', JSON.stringify({ type: 'DIGEST', summary }));
  }
}
