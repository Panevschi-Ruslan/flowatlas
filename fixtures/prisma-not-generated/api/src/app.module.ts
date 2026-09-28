import { Module } from '@nestjs/common';

import { OrdersService } from './orders/orders.service.js';
import { UsersService } from './users/users.service.js';

@Module({ providers: [UsersService, OrdersService] })
export class AppModule {}
