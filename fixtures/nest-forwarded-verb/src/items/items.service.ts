import { Injectable } from '@nestjs/common';
import { ItemsClient } from './items.client.js';

@Injectable()
export class ItemsService {
  constructor(private readonly client: ItemsClient) {}

  async restore(): Promise<void> {
    await this.client.replace('featured', 'promoted');
  }

  async purge(): Promise<void> {
    await this.client.get('expired');
  }
}
