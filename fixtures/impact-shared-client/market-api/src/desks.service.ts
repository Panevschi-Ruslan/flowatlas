import { Injectable } from '@nestjs/common';
import { EventsService } from './events.service';

/** `ackCall` is the second method impact is asked about. */
@Injectable()
export class DesksService {
  private readonly acked = new Set<string>();

  constructor(private readonly events: EventsService) {}

  ackCall(deskId: string): void {
    this.acked.add(deskId);
  }

  async call(shopId: string, deskId: string): Promise<void> {
    this.acked.delete(deskId);
    await this.events.deskUrgent(shopId, deskId);
  }

  list(): string[] {
    return [...this.acked];
  }

  close(deskId: string): void {
    this.acked.delete(deskId);
  }
}
