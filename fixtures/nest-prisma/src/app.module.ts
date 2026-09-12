import { Module } from '@nestjs/common';
import { OrdersModule } from './orders/orders.module.js';

@Module({ imports: [OrdersModule] })
export class AppModule {}
