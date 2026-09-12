import { Module } from '@nestjs/common';
import { OrderStore } from './orders/order.store.js';
import { OrdersController } from './orders/orders.controller.js';
import { OrdersService } from './orders/orders.service.js';

@Module({ controllers: [OrdersController], providers: [OrdersService, OrderStore] })
export class AppModule {}
