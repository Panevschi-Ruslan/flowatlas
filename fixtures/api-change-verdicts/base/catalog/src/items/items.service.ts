import { Injectable } from '@nestjs/common';
import { EventBus } from '../bus/event-bus';
import type { CreateItemBody, ItemChanged, ItemView } from './item.types';

@Injectable()
export class ItemsService {
  constructor(private readonly bus: EventBus) {}

  async create(body: CreateItemBody): Promise<ItemView> {
    const item: ItemView = { id: 'item-1', name: body.name, price: body.price };
    const changed: ItemChanged = { itemId: item.id, name: item.name, label: body.name.toUpperCase(), legacyCode: 'L-1' };
    await this.bus.publish('item.changed', changed);
    return item;
  }
}
