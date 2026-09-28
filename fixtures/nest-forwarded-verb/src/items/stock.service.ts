import { Injectable } from '@nestjs/common';
import { ItemsClient } from './items.client.js';

@Injectable()
export class StockService {
  constructor(private readonly client: ItemsClient) {}

  async refill(): Promise<void> {
    await this.client.replace('restocked');
  }

  async archive(): Promise<void> {
    await this.client.send('/items/archive', { method: 'POST' });
  }

  async retire(): Promise<void> {
    await this.client.get('retired');
  }
}
