import { Module, forwardRef } from '@nestjs/common';

import { AltCacheModule } from '../cache/alt-cache.module';
import { CacheModule } from '../cache/cache.module';
import { ConfigModule } from '../config/config.module';
import { PaymentsModule } from '../payments/payments.module';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    CacheModule,
    AltCacheModule,
    ConfigModule,
    forwardRef(() => PaymentsModule),
  ],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
