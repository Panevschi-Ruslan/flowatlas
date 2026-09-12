import { Module } from '@nestjs/common';
import { OrdersController } from './orders/orders.controller.js';
import { OrdersService } from './orders/orders.service.js';

@Module({ controllers: [OrdersController], providers: [OrdersService] })
export class AppModule {}
