import { Module } from '@nestjs/common';

import { Bot } from './bot.js';
import { OrdersService } from './orders.service.js';

@Module({ providers: [Bot, OrdersService] })
export class AppModule {}
