import { Module } from '@nestjs/common';

import { ShopBus } from './bus/shop-bus.service';
import { OrderMailDispatcher } from './mail/order-mail.dispatcher';
import { Mails } from './mail/mails.service';

@Module({
  providers: [ShopBus, Mails, OrderMailDispatcher],
})
export class AppModule {}
