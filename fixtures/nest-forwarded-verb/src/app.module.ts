import { Module } from '@nestjs/common';
import { ItemsClient } from './items/items.client.js';
import { ItemsService } from './items/items.service.js';
import { StockService } from './items/stock.service.js';

@Module({ providers: [ItemsClient, ItemsService, StockService] })
export class AppModule {}
