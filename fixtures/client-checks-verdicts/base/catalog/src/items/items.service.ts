import { Injectable } from '@nestjs/common';
import { EventBus } from '../bus/event-bus';
import type { ItemChanged, ItemView } from './item.types';

@Injectable()
export class ItemsService {
  constructor(private readonly bus: EventBus) {}

  async create(name: string): Promise<ItemView> {
    const item: ItemView = { id: 'item-1', name, status: 'draft' };
    const changed: ItemChanged = { itemId: item.id, kind: 'created' };
    await this.bus.publish('item.changed', changed);
    return item;
  }
}
