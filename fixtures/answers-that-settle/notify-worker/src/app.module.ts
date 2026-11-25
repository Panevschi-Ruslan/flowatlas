import { Module } from '@nestjs/common';

import { VenueBus } from './bus/venue-bus.service';
import { AuditTrail } from './feed/audit-trail.service';
import { FeedGateway } from './feed/feed.gateway';
import { FeedRelay } from './feed/feed-relay.service';
import { RoomBoard } from './feed/room-board.service';
import { OrderWatch } from './orders/order-watch.service';
import { PushSender } from './push/push-sender.service';
import { PushService } from './push/push.service';

@Module({
  providers: [VenueBus, PushService, PushSender, FeedRelay, FeedGateway, RoomBoard, AuditTrail, OrderWatch],
})
export class AppModule {}
