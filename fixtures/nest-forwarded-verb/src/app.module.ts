import { Module } from '@nestjs/common';
import { ItemsClient } from './items/items.client.js';
import { ItemsService } from './items/items.service.js';
import { Ordering, OrdersClient } from './items/orders.client.js';
import { Restocker, StockClient } from './items/stock.client.js';
import { StockService } from './items/stock.service.js';

@Module({ providers: [ItemsClient, ItemsService, StockService, StockClient, Restocker, OrdersClient, Ordering] })
export class AppModule {}
