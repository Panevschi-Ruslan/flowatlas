import { Injectable } from '@nestjs/common';
import { EventsService } from './events.service';

/** `listByShop` is the method impact is asked about: one route serves it. */
@Injectable()
export class ItemsService {
  private readonly items = new Map<string, string[]>();

  constructor(private readonly events: EventsService) {}

  listByShop(shopId: string): string[] {
    return this.items.get(shopId) ?? [];
  }

  async create(shopId: string, name: string): Promise<void> {
    this.items.set(shopId, [...(this.items.get(shopId) ?? []), name]);
    await this.events.itemsChanged(shopId);
  }
}
