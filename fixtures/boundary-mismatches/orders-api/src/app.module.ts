import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { StreamsController } from './orders/streams.controller';

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [OrdersController, StreamsController],
  providers: [OrdersService],
})
export class AppModule {}
