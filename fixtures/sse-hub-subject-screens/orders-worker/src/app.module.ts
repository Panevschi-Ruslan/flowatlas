import { Module } from '@nestjs/common';

import { OrderEventsController } from './events/order-events.controller';

@Module({ controllers: [OrderEventsController] })
export class AppModule {}
