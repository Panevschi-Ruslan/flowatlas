import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import catalogConfig from './catalog.config';
import { CheckoutController } from './checkout.controller';
import { ShopClient } from './clients/shop.client';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: [catalogConfig] })],
  controllers: [CheckoutController],
  providers: [ShopClient],
})
export class AppModule {}
