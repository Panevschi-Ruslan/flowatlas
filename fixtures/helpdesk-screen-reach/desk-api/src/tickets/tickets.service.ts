import { Injectable } from '@nestjs/common';
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';

/**
 * The publisher. One channel per desk carries every kind of message about it,
 * told apart by `type`. `reopen` is called by nothing: what it publishes is
 * sent by code that never runs.
 */
@Injectable()
export class TicketsService {
  private readonly bus: RedisClientType = createClient();

  async assign(deskId: string, ticketId: string, agentId: string): Promise<void> {
    await this.bus.publish(`desk:${deskId}:events`, JSON.stringify({ type: 'TICKET_ASSIGNED', ticketId, agentId }));
  }

  async close(deskId: string, ticketId: string): Promise<void> {
    await this.bus.publish(`desk:${deskId}:events`, JSON.stringify({ type: 'TICKET_CLOSED', ticketId }));
  }

  async reopen(deskId: string, ticketId: string): Promise<void> {
    await this.bus.publish(`desk:${deskId}:events`, JSON.stringify({ type: 'TICKET_REOPENED', ticketId }));
  }
}
