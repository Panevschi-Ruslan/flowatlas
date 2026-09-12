import { Module } from '@nestjs/common';
import { OrdersRepository } from './orders/orders.repository.js';
import { OrdersService } from './orders/orders.service.js';

@Module({ providers: [OrdersService, OrdersRepository] })
export class AppModule {}
