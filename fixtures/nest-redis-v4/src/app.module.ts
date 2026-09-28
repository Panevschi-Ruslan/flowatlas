import { Module } from '@nestjs/common';

import { FeedService } from './feed/feed.service';

@Module({
  providers: [FeedService],
})
export class AppModule {}
