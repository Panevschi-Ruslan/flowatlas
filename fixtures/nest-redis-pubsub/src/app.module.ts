import { Module } from '@nestjs/common';

import { CachePublisherService } from './cache/cache-publisher.service';
import { CacheSubscriberService } from './cache/cache-subscriber.service';
import { CacheController } from './cache/cache.controller';

@Module({
  controllers: [CacheController],
  providers: [CachePublisherService, CacheSubscriberService],
})
export class AppModule {}
